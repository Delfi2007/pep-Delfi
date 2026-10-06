"""Stage 3 — turn every input type into text, and measure how well that works.

Real data
  Enron / SpamAssassin / phishing emails, UCI + NUS SMS  -> text records (all non-grooming)
  RVL-CDIP scanned pages      -> EasyOCR text (real documents, non-grooming)
  FUNSD scanned forms         -> OCR accuracy (character error rate) against human labels
  LibriSpeech test-clean      -> Whisper accuracy (word error rate) against human transcripts
  COCO photos                 -> image-hash robustness (SHA-256 vs aHash / dHash / pHash)
Synthetic data (ground truth known)
  PDF / Word                  -> text extraction, parsed back into messages
  screenshots                 -> EasyOCR, bubbles mapped back to sender by side of screen
  voice notes                 -> Whisper per voice note
  videos                      -> Whisper on the audio track + EasyOCR on the final frame

Outputs: data_v2/derived/*.jsonl  and  results_v2/conversion_*.json
"""
import email
import hashlib
import io
import json
import mailbox
import re
import subprocess
import time
from email import policy
from pathlib import Path

import numpy as np

from config import DERIVED, EASYOCR_DIR, N, REAL, RESULTS, SMOKE, SYN, log, rng

TS_RE = re.compile(r"^\d{1,2}[:.;,]\d{2}$")
TS_TAIL_RE = re.compile(r"\s+\d{1,2}[:.;,]\d{2}$")
LINE_RE = re.compile(r"^\[(\d{2}/\d{2}/\d{4}), (\d{2}:\d{2})\] ([^:]+): (.*)$")


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f]


def split_of(key, test_frac=0.3):
    h = int(hashlib.md5(key.encode()).hexdigest(), 16) % 1000 / 1000
    return "test" if h < test_frac else "train"


def norm(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def save_json(name, obj):
    (RESULTS / name).write_text(json.dumps(obj, indent=2))


# =========================================================================== real text
def email_body(msg):
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
        text = part.get_content() if part else ""
    except Exception:
        try:
            text = msg.get_payload(decode=True).decode("utf-8", "ignore")
        except Exception:
            text = ""
    text = re.sub(r"<[^>]+>", " ", text)                       # crude html strip
    text = re.split(r"\n-+ ?(Original Message|Forwarded by)", text)[0]   # drop quoted thread
    lines = [l for l in text.splitlines() if not l.strip().startswith(">")]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()[:4000]


def parse_email_file(path):
    with open(path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)
    return str(msg.get("From", "unknown"))[:80], email_body(msg)


def enron_from_tar(path, want):
    """Read Enron emails straight from the .tar.gz stream. Unpacking ~517k tiny
    files to disk on Windows (with antivirus scanning each one) took hours; this
    takes minutes. Keeps roughly every k-th email so the sample spans the corpus."""
    import tarfile
    out, seen = [], 0
    keep_every = 8          # ~517k emails / 8 ≈ 65k candidates for a 60k target
    with tarfile.open(path, "r:gz") as t:
        for m in t:
            if not m.isfile():
                continue
            seen += 1
            if seen % keep_every:
                continue
            try:
                msg = email.message_from_bytes(t.extractfile(m).read(), policy=policy.default)
                body = email_body(msg)
            except Exception:
                continue
            if len(body) >= 20:
                out.append((str(msg.get("From", "unknown"))[:80], body))
            if len(out) >= want:
                break
    return out


def real_text():
    rows = []
    # Enron
    maildir = REAL / "enron" / "maildir"
    tar = REAL / "enron" / "enron_mail_20150507.tar.gz"
    if tar.exists():
        for n, (sender, body) in enumerate(enron_from_tar(tar, N["enron_emails"])):
            rows.append({"id": f"enron-{n:06d}", "origin": "real", "source": "enron", "modality": "email",
                         "label": 0, "messages": [[sender, body]]})
        log("convert", f"enron (from archive): {sum(1 for r in rows if r['source'] == 'enron')} emails")
    elif maildir.exists():
        files = [p for p in maildir.rglob("*") if p.is_file()]
        rng(1).shuffle(files)
        n = 0
        for p in files:
            if n >= N["enron_emails"]:
                break
            try:
                sender, body = parse_email_file(p)
            except Exception:
                continue
            if len(body) < 20:
                continue
            rows.append({"id": f"enron-{n:06d}", "origin": "real", "source": "enron", "modality": "email",
                         "label": 0, "messages": [[sender, body]]})
            n += 1
        log("convert", f"enron: {n} emails")
    elif (REAL / "enron" / "hf").exists():                      # Hugging Face fallback copy
        import pandas as pd
        df = pd.concat([pd.read_parquet(p) for p in sorted((REAL / "enron" / "hf").rglob("*.parquet"))])
        body_col = next(c for c in df.columns if c.lower() in ("body", "text", "message", "content"))
        from_col = next((c for c in df.columns if c.lower() in ("from", "sender", "from_address")), None)
        df = df.sample(n=min(N["enron_emails"], len(df)), random_state=42)
        n = 0
        for _, row in df.iterrows():
            body = re.sub(r"\s+", " ", str(row[body_col]))[:4000]
            if len(body) < 20:
                continue
            rows.append({"id": f"enron-{n:06d}", "origin": "real", "source": "enron", "modality": "email", "label": 0,
                         "messages": [[str(row[from_col])[:80] if from_col else "sender", body]]})
            n += 1
        log("convert", f"enron (hf copy): {n} emails")
    # SpamAssassin
    sa = REAL / "spamassassin"
    for sub in ("easy_ham", "hard_ham", "spam", "spam_2"):
        d = sa / sub
        if not d.exists():
            continue
        k = 0
        for p in sorted(d.iterdir()):
            if p.name.startswith("cmds") or not p.is_file():
                continue
            try:
                sender, body = parse_email_file(p)
            except Exception:
                continue
            if len(body) < 20:
                continue
            rows.append({"id": f"sa-{sub}-{k:05d}", "origin": "real", "source": f"spamassassin_{sub}",
                         "modality": "email", "label": 0, "messages": [[sender, body]]})
            k += 1
        log("convert", f"spamassassin {sub}: {k}")
    # Nazario phishing
    for p in sorted((REAL / "phishing").glob("*.mbox")):
        k = 0
        for msg in mailbox.mbox(str(p), factory=lambda f: email.message_from_binary_file(f, policy=policy.default)):
            try:
                body = email_body(msg)
            except Exception:
                continue
            if len(body) < 20:
                continue
            rows.append({"id": f"phish-{p.stem}-{k:05d}", "origin": "real", "source": "phishing", "modality": "email",
                         "label": 0, "messages": [[str(msg.get("From", "unknown"))[:80], body]]})
            k += 1
        log("convert", f"phishing {p.name}: {k}")
    # UCI SMS
    uci = REAL / "sms_uci" / "SMSSpamCollection"
    if uci.exists():
        k = 0
        for line in uci.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "\t" not in line:
                continue
            tag, text = line.split("\t", 1)
            rows.append({"id": f"uci-{k:05d}", "origin": "real", "source": f"uci_sms_{tag}", "modality": "sms",
                         "label": 0, "messages": [["sender", text]]})
            k += 1
        log("convert", f"uci sms: {k}")
    # NUS SMS — published as XML inside a zip
    nus_zip = REAL / "sms_nus" / "smsCorpus_en_xml_2015.03.09_all.zip"
    if nus_zip.exists():
        import xml.etree.ElementTree as ET
        import zipfile
        with zipfile.ZipFile(nus_zip) as z:
            root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
        k = 0
        for m in root.iter("message"):
            text = (m.findtext("text") or "").strip()
            if not text:
                continue
            sender = m.findtext("source/srcNumber") or "sender"
            rows.append({"id": f"nus-{k:06d}", "origin": "real", "source": "nus_sms", "modality": "sms",
                         "label": 0, "messages": [[f"nus_{sender}", text]]})
            k += 1
        log("convert", f"nus sms: {k}")
    nus = REAL / "sms_nus" / "smsCorpus_en.json"
    if nus.exists() and not nus_zip.exists():
        try:
            data = json.loads(nus.read_text(encoding="utf-8", errors="ignore"))
            msgs = data.get("smsCorpus", {}).get("message", [])
            k = 0
            for m in msgs:
                t = m.get("text", {})
                text = t.get("$") if isinstance(t, dict) else str(t)
                if not text:
                    continue
                src = m.get("source", {}).get("srcNumber", {})
                sender = str(src.get("$", "sender") if isinstance(src, dict) else src)
                rows.append({"id": f"nus-{k:06d}", "origin": "real", "source": "nus_sms", "modality": "sms",
                             "label": 0, "messages": [[sender, str(text)]]})
                k += 1
            log("convert", f"nus sms: {k}")
        except Exception as e:
            log("convert", f"nus sms parse failed: {e}")
    for r in rows:
        r["split"] = split_of(r["id"])
    write_jsonl(DERIVED / "real_text.jsonl", rows)
    by = {}
    for r in rows:
        by[r["source"]] = by.get(r["source"], 0) + 1
    return {"records": len(rows), "by_source": by}


# =========================================================================== documents
def documents():
    from docx import Document
    from pypdf import PdfReader
    out = {}
    for pool in ("A", "B"):
        rows = read_jsonl(SYN / f"docs_{pool}.jsonl")
        derived, exact = [], {"pdf": 0, "docx": 0}
        for c in rows:
            gt = [[a, t] for a, t in c["messages"]]
            for fmt in ("pdf", "docx"):
                path = SYN / "docs" / pool / f"{c['id']}.{fmt}"
                if fmt == "pdf":
                    text = "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)
                    # undo the PDF line wrapping: a line not starting with "[dd/mm/yyyy" continues the previous one
                    lines = []
                    for l in text.splitlines():
                        if l.startswith("[") or not lines:
                            lines.append(l)
                        else:
                            lines[-1] += " " + l
                else:
                    lines = [p.text for p in Document(str(path)).paragraphs]
                msgs = [[m.group(3), m.group(4)] for m in (LINE_RE.match(l.strip()) for l in lines) if m]
                exact[fmt] += int([norm(t) for _, t in msgs] == [norm(t) for _, t in gt])
                derived.append({**{k: c[k] for k in ("category", "label", "predator", "pool")},
                                "id": f"{c['id']}-{fmt}", "modality": fmt, "origin": "synthetic",
                                "messages": msgs, "gt_messages": gt})
        write_jsonl(DERIVED / f"docs_{pool}.jsonl", derived)
        out[pool] = {fmt: round(v / max(1, len(rows)), 4) for fmt, v in exact.items()}
    return {"exact_message_recovery_rate": out}


# =========================================================================== OCR
_READER = None


def reader():
    global _READER
    if _READER is None:
        import easyocr
        _READER = easyocr.Reader(["en"], gpu=True, model_storage_directory=str(EASYOCR_DIR), verbose=False)
    return _READER


def ocr_chat(img_array, width=720, header_h=110):
    """OCR a chat screenshot and rebuild messages: header text = contact name,
    bubbles on the right = phone owner, on the left = contact."""
    res = reader().readtext(img_array, paragraph=False)
    header = " ".join(t for b, t, c in res if max(p[1] for p in b) < header_h and t.lower() != "online")
    boxes = []
    for b, t, c in res:
        ys = [p[1] for p in b]
        xs = [p[0] for p in b]
        t = TS_TAIL_RE.sub("", t).strip()              # drop a bubble's time stamp ("8:37" often reads "8.37")
        if max(ys) < header_h or not t or TS_RE.match(t):
            continue
        side = "owner" if (min(xs) + max(xs)) / 2 > width / 2 else "contact"
        boxes.append(((min(ys) + max(ys)) / 2, min(xs), min(ys), max(ys), side, t))
    # EasyOCR may split one printed line into several boxes: group boxes into text
    # lines by vertical centre, then read each line left to right.
    boxes.sort()
    lines = []
    for yc, x, y0, y1, side, t in boxes:
        if lines and lines[-1]["side"] == side and abs(yc - lines[-1]["yc"]) < 14:
            lines[-1]["parts"].append((x, t))
            lines[-1]["y1"] = max(lines[-1]["y1"], y1)
        else:
            lines.append({"yc": yc, "y0": y0, "y1": y1, "side": side, "parts": [(x, t)]})
    msgs = []
    for ln in lines:
        text = " ".join(t for _, t in sorted(ln["parts"]))
        if msgs and msgs[-1][0] == ln["side"] and ln["y0"] - msgs[-1][2] < 30:
            msgs[-1][1] += " " + text
            msgs[-1][2] = ln["y1"]
        else:
            msgs.append([ln["side"], text, ln["y1"]])
    return header.strip(), [[s, t] for s, t, _ in msgs]


def screens():
    import jiwer
    from PIL import Image
    out, cers = {}, []
    for pool in ("A", "B"):
        rows = read_jsonl(SYN / f"screens_{pool}.jsonl")[: N["ocr_screens"]]
        derived = []
        t0 = time.time()
        for c in rows:
            img = np.array(Image.open(SYN / c["files"][0]).convert("RGB"))
            header, msgs = ocr_chat(img)
            contact = [a for a, _ in c["messages"] if a != c["owner"]]
            amap = {"owner": c["owner"], "contact": contact[0] if contact else c["owner"]}
            gt_text = norm(" ".join(t for _, t in c["messages"]))
            ocr_text = norm(" ".join(t for _, t in msgs))
            if gt_text:
                cers.append(jiwer.cer(gt_text, ocr_text or "-"))
            derived.append({**{k: c[k] for k in ("category", "label", "predator", "pool")}, "id": c["id"],
                            "modality": "screenshot", "origin": "synthetic", "header": header,
                            "messages": [[amap[s], t] for s, t in msgs], "gt_messages": c["messages"]})
        write_jsonl(DERIVED / f"screens_{pool}.jsonl", derived)
        out[pool] = {"n": len(rows), "seconds": round(time.time() - t0)}
        log("convert", f"screens {pool}: {len(rows)} OCR'd in {time.time() - t0:.0f}s")
    return {"screens": out, "screenshot_cer_mean": round(float(np.mean(cers)), 4) if cers else None}


def funsd():
    """OCR accuracy on real scanned forms, word by word against the human annotations."""
    import jiwer
    from PIL import Image
    base = REAL / "funsd" / "dataset" / "testing_data"
    if not base.exists():
        return {"skipped": "FUNSD not found"}
    imgs = sorted((base / "images").glob("*.png"))[: N["funsd_docs"]]
    gts, preds, page_f1 = [], [], []
    for p in imgs:
        ann = json.loads((base / "annotations" / f"{p.stem}.json").read_text(encoding="utf-8"))
        words = [w for f in ann["form"] for w in f["words"] if w["text"].strip()]
        img = np.array(Image.open(p).convert("L"))
        boxes = [[w["box"][0], w["box"][2], w["box"][1], w["box"][3]] for w in words]
        for i in range(0, len(boxes), 64):
            chunk = boxes[i:i + 64]
            res = reader().recognize(img, horizontal_list=chunk, free_list=[], detail=1, paragraph=False)
            got = [t for _, t, _ in res]
            got += [""] * (len(chunk) - len(got))
            gts += [w["text"] for w in words[i:i + 64]]
            preds += got[: len(chunk)]
        full = {norm(t) for _, t, _ in reader().readtext(img)}
        truth = {norm(w["text"]) for w in words}
        inter = len(full & truth)
        page_f1.append(2 * inter / max(1, len(full) + len(truth)))
    pairs = [(norm(g), norm(p)) for g, p in zip(gts, preds) if norm(g)]
    cer = jiwer.cer([g for g, _ in pairs], [p if p else "-" for _, p in pairs])
    acc = float(np.mean([g == p for g, p in pairs]))
    return {"documents": len(imgs), "words": len(pairs), "word_cer": round(cer, 4), "word_accuracy": round(acc, 4),
            "page_bag_of_words_f1": round(float(np.mean(page_f1)), 4)}


def rvl():
    import pandas as pd
    from PIL import Image
    shards = sorted((REAL / "rvl_cdip" / "data").glob("*.parquet"))
    if not shards:
        return {"skipped": "RVL-CDIP not found"}
    df = pd.concat([pd.read_parquet(s) for s in shards], ignore_index=True)
    df = df.sample(n=min(N["rvl_docs"], len(df)), random_state=42)
    rows = []
    t0 = time.time()
    img_col = [c for c in df.columns if "image" in c.lower()][0]
    for i, rec in enumerate(df.itertuples(index=False)):
        im = getattr(rec, img_col)
        data = im["bytes"] if isinstance(im, dict) else im
        img = np.array(Image.open(io.BytesIO(data)).convert("L"))
        text = " ".join(t for _, t, _ in reader().readtext(img))
        if len(text) < 20:
            continue
        rid = f"rvl-{i:05d}"
        rows.append({"id": rid, "origin": "real", "source": "rvl_cdip", "modality": "scanned_document",
                     "label": 0, "messages": [["document", text]], "split": split_of(rid)})
    write_jsonl(DERIVED / "rvl_ocr.jsonl", rows)
    return {"pages_ocr": len(rows), "seconds": round(time.time() - t0)}


def free_ocr():
    global _READER
    _READER = None
    import gc
    import torch
    gc.collect()
    torch.cuda.empty_cache()


# =========================================================================== ASR
_ASR = None


def asr():
    global _ASR
    if _ASR is None:
        import torch
        from transformers import pipeline
        _ASR = pipeline("automatic-speech-recognition", model="openai/whisper-small", device=0,
                        dtype=torch.float16, chunk_length_s=30)
    return _ASR


def load_audio(path):
    import soundfile as sf
    from scipy.signal import resample_poly
    a, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != 16000:
        g = np.gcd(int(sr), 16000)
        a = resample_poly(a, 16000 // g, int(sr) // g).astype(np.float32)
    return a


def transcribe(arrays, batch=16):
    """One transcript per input, guaranteed.

    The chunked pipeline can silently return nothing for a very short clip (a
    one-word voice note), which shifts every later transcript onto the wrong
    message. So: pad clips to at least one second, transcribe short clips
    without chunking, and verify the output count — falling back to one clip
    at a time if it ever disagrees."""
    arrays = [np.pad(a, (0, max(0, 16000 - len(a)))) for a in arrays]
    gen = {"language": "en", "task": "transcribe"}
    short = all(len(a) <= 30 * 16000 for a in arrays)
    kw = {} if short else {"chunk_length_s": 30}
    out = asr()([{"raw": a, "sampling_rate": 16000} for a in arrays], batch_size=batch, generate_kwargs=gen, **kw)
    texts = [o["text"].strip() for o in out]
    if len(texts) != len(arrays):
        texts = [asr()({"raw": a, "sampling_rate": 16000}, generate_kwargs=gen, **({} if len(a) <= 30 * 16000 else
                       {"chunk_length_s": 30}))["text"].strip() for a in arrays]
    assert len(texts) == len(arrays)
    return texts


def librispeech():
    import jiwer
    base = REAL / "librispeech" / "LibriSpeech" / "test-clean"
    if not base.exists():
        return {"skipped": "LibriSpeech not found"}
    items = []
    for trans in sorted(base.rglob("*.trans.txt")):
        for line in trans.read_text().splitlines():
            uid, text = line.split(" ", 1)
            items.append((trans.parent / f"{uid}.flac", text))
    items = items[: N["librispeech_utts"]]
    t0 = time.time()
    hyps = []
    for i in range(0, len(items), 64):
        hyps += transcribe([load_audio(p) for p, _ in items[i:i + 64]])
    refs = [norm(t) for _, t in items]
    hyps = [norm(h) or "-" for h in hyps]
    secs = sum(len(load_audio(p)) / 16000 for p, _ in items[:50]) / max(1, min(50, len(items))) * len(items)
    return {"utterances": len(items), "wer": round(jiwer.wer(refs, hyps), 4), "cer": round(jiwer.cer(refs, hyps), 4),
            "audio_hours_est": round(secs / 3600, 2), "seconds": round(time.time() - t0)}


def voice_test():
    """Re-transcribe the voice-note TEST pool (B) with the fixed transcriber."""
    return voice(pools=("B",))


def voice(pools=("A", "B")):
    import jiwer
    out, refs, hyps = {}, [], []
    for pool in pools:
        rows = read_jsonl(SYN / f"voice_{pool}.jsonl")[: N["asr_voice"]]
        t0 = time.time()
        flat = [(c, clip) for c in rows for clip in c["clips"]]
        texts = []
        for i in range(0, len(flat), 64):
            texts += transcribe([load_audio(SYN / clip["file"]) for _, clip in flat[i:i + 64]])
        by = {}
        for (c, clip), t in zip(flat, texts):
            by.setdefault(c["id"], []).append([clip["author"], t])
        derived = []
        for c in rows:
            msgs = by.get(c["id"], [])
            assert len(msgs) == len(c["clips"]), f"{c['id']}: {len(msgs)} transcripts for {len(c['clips'])} clips"
            refs.append(norm(" ".join(t for _, t in c["messages"])))
            hyps.append(norm(" ".join(t for _, t in msgs)) or "-")
            derived.append({**{k: c[k] for k in ("category", "label", "predator", "pool")}, "id": c["id"],
                            "modality": "voice_note", "origin": "synthetic", "messages": msgs,
                            "gt_messages": c["messages"]})
        write_jsonl(DERIVED / f"voice_{pool}.jsonl", derived)
        out[pool] = {"conversations": len(rows), "voice_notes": len(flat), "seconds": round(time.time() - t0)}
        log("convert", f"voice {pool}: {len(flat)} voice notes transcribed in {time.time() - t0:.0f}s")
    return {"voice": out, "voice_note_wer": round(jiwer.wer(refs, hyps), 4) if refs else None}


def video():
    import imageio_ffmpeg
    import jiwer
    from PIL import Image
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tmp = DERIVED / "_video_tmp"
    tmp.mkdir(exist_ok=True)
    out, refs, hyps = {}, [], []
    for pool in ("A", "B"):
        rows = read_jsonl(SYN / f"video_{pool}.jsonl")[: N["asr_video"]]
        t0 = time.time()
        derived = []
        for c in rows:
            mp4 = SYN / c["files"][0]
            wav, png = tmp / "a.wav", tmp / "f.png"
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(mp4), "-ac", "1", "-ar", "16000", str(wav)], check=True)
            secs = imageio_ffmpeg.count_frames_and_secs(str(mp4))[1]
            subprocess.run([ff, "-y", "-loglevel", "error", "-ss", f"{max(0.0, secs - 0.3):.2f}", "-i", str(mp4),
                            "-frames:v", "1", str(png)], check=True)
            transcript = transcribe([load_audio(wav)])[0]
            header, msgs = ocr_chat(np.array(Image.open(png).convert("RGB")))
            amap = {"owner": c["owner"], "contact": [a for a, _ in c["messages"] if a != c["owner"]][0]
                    if len({a for a, _ in c["messages"]}) > 1 else c["owner"]}
            refs.append(norm(" ".join(t for _, t in c["messages"])))
            hyps.append(norm(transcript) or "-")
            derived.append({**{k: c[k] for k in ("category", "label", "predator", "pool")}, "id": c["id"],
                            "modality": "video", "origin": "synthetic", "transcript": transcript,
                            "messages": [[amap[s], t] for s, t in msgs], "gt_messages": c["messages"]})
        write_jsonl(DERIVED / f"video_{pool}.jsonl", derived)
        out[pool] = {"videos": len(rows), "seconds": round(time.time() - t0)}
        log("convert", f"video {pool}: {len(rows)} videos in {time.time() - t0:.0f}s")
    return {"video": out, "video_audio_wer": round(jiwer.wer(refs, hyps), 4) if refs else None}


# =========================================================================== hashing on real photos
def coco_hashing():
    from PIL import Image
    from phash import PERCEPTUAL, TRANSFORM_LABELS, TRANSFORMS, fingerprint, hamming, to_bytes
    from sklearn.metrics import roc_auc_score
    imgs = sorted((REAL / "coco" / "val2017").glob("*.jpg"))
    if not imgs:
        return {"skipped": "COCO not found"}
    rng(5).shuffle(imgs)
    imgs = imgs[: N["coco_images"]]
    T = 10
    origs, pics = [], []
    for p in imgs:
        im = Image.open(p).convert("RGB")
        im.thumbnail((512, 512))
        pics.append(im)
        origs.append(fingerprint(im, p.read_bytes()))
    per, genuine = {h: {} for h in ["sha256", *PERCEPTUAL]}, {h: [] for h in PERCEPTUAL}
    for tname, fn in TRANSFORMS.items():
        d = {h: [] for h in PERCEPTUAL}
        sha = 0
        for im, o in zip(pics, origs):
            e = fn(im).convert("RGB")
            fp = fingerprint(e, to_bytes(e))
            sha += fp["sha256"] == o["sha256"]
            for h in PERCEPTUAL:
                d[h].append(hamming(fp[h], o[h]))
        per["sha256"][tname] = round(sha / len(pics), 4)
        for h in PERCEPTUAL:
            arr = np.array(d[h])
            genuine[h] += arr.tolist()
            per[h][tname] = round(float((arr <= T).mean()), 4)
    r = rng(6)
    pairs = [(r.randrange(len(origs)), r.randrange(len(origs))) for _ in range(20000)]
    pairs = [(a, b) for a, b in pairs if a != b]
    summary = {}
    for h in PERCEPTUAL:
        imp = np.array([hamming(origs[a][h], origs[b][h]) for a, b in pairs])
        g = np.array(genuine[h])
        y = np.r_[np.ones(len(g)), np.zeros(len(imp))]
        summary[h] = {"match_rate": round(float((g <= T).mean()), 4),
                      "false_match_rate": round(float((imp <= T).mean()), 6),
                      "roc_auc": round(float(roc_auc_score(y, -np.r_[g, imp])), 4)}
    summary["sha256"] = {"match_rate": round(float(np.mean(list(per["sha256"].values()))), 4),
                         "false_match_rate": 0.0, "roc_auc": None}
    return {"images": len(pics), "threshold": T, "transforms": TRANSFORM_LABELS, "per_transform": per,
            "summary": summary}


STEPS = [("real_text", real_text, False), ("documents", documents, False), ("screens", screens, True),
         ("rvl", rvl, True), ("video", video, True), ("voice", voice, True),
         # after training ("eval" mode): the corrected voice test set, then measurement-only steps
         ("voice_test", voice_test, True),
         ("funsd", funsd, True), ("librispeech", librispeech, True), ("coco_hashing", coco_hashing, False)]
TRAIN_INPUTS = {"real_text", "documents", "screens", "rvl", "video", "voice"}


def main(only=None):
    for name, fn, gpu in STEPS:
        if only == {"training"}:
            if name not in TRAIN_INPUTS:
                continue
        elif only == {"eval"}:
            if name in TRAIN_INPUTS:
                continue
        elif only and name not in only:
            continue
        marker = DERIVED / f".done_{name}"
        if marker.exists():
            log("convert", f"skip {name} (done)")
            continue
        t0 = time.time()
        try:
            res = fn()
        except Exception as e:                       # one failed step must not block the others
            import traceback
            traceback.print_exc()
            save_json(f"conversion_{name}.json", {"failed": f"{type(e).__name__}: {e}"})
            log("convert", f"FAILED {name}: {type(e).__name__}: {e} — continuing with the next step")
            continue
        res["elapsed_seconds"] = round(time.time() - t0)
        save_json(f"conversion_{name}.json", res)
        marker.write_text("ok")
        log("convert", f"{name}: {json.dumps(res)[:300]}")
        if name in ("video", "funsd"):    # release EasyOCR before Whisper-only steps
            free_ocr()
    log("convert", "stage complete")


if __name__ == "__main__":
    import sys
    main(set(sys.argv[1:]) or None)

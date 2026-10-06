"""Stage 1 — download the real datasets and the pre-trained models (resumable).

Real data (~4.5 GB on disk once unpacked):
  Enron email, UCI SMS Spam, NUS SMS, SpamAssassin, Nazario phishing,
  FUNSD, RVL-CDIP (3 test shards), COCO val2017, LibriSpeech test-clean.
Models: Whisper-small, Piper English voices, EasyOCR English.

Every file is skipped if it already exists, so the stage can be re-run safely.
"""
import json
import shutil
import tarfile
import time
import urllib.request
import zipfile

from config import CACHE, EASYOCR_DIR, N, PIPER_DIR, REAL, SMOKE, log

UA = {"User-Agent": "Mozilla/5.0 (research dataset download)"}

FILES = {
    "enron/enron_mail_20150507.tar.gz": "https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz",
    "sms_uci/smsspamcollection.zip": "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip",
    "spamassassin/20030228_easy_ham.tar.bz2": "https://spamassassin.apache.org/old/publiccorpus/20030228_easy_ham.tar.bz2",
    "spamassassin/20030228_hard_ham.tar.bz2": "https://spamassassin.apache.org/old/publiccorpus/20030228_hard_ham.tar.bz2",
    "spamassassin/20030228_spam.tar.bz2": "https://spamassassin.apache.org/old/publiccorpus/20030228_spam.tar.bz2",
    "spamassassin/20050311_spam_2.tar.bz2": "https://spamassassin.apache.org/old/publiccorpus/20050311_spam_2.tar.bz2",
    "phishing/phishing-2018.mbox": "https://monkey.org/~jose/phishing/phishing-2018",
    "phishing/phishing-2019.mbox": "https://monkey.org/~jose/phishing/phishing-2019",
    "phishing/phishing-2020.mbox": "https://monkey.org/~jose/phishing/phishing-2020",
    "phishing/phishing-2021.mbox": "https://monkey.org/~jose/phishing/phishing-2021",
    "funsd/dataset.zip": "https://guillaumejaume.github.io/FUNSD/dataset.zip",
    "coco/val2017.zip": "http://images.cocodataset.org/zips/val2017.zip",
    "librispeech/test-clean.tar.gz": "https://www.openslr.org/resources/12/test-clean.tar.gz",
}
SMOKE_SKIP = {"enron/enron_mail_20150507.tar.gz", "coco/val2017.zip", "librispeech/test-clean.tar.gz"}

PIPER_VOICES = [
    "en/en_US/lessac/medium/en_US-lessac-medium",
    "en/en_US/amy/medium/en_US-amy-medium",
    "en/en_US/ryan/medium/en_US-ryan-medium",
    "en/en_GB/alan/medium/en_GB-alan-medium",
    "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium",
    "en/en_US/joe/medium/en_US-joe-medium",
]


def fetch(url, dest, retries=4):
    if dest.exists() and dest.stat().st_size > 0:
        log("download", f"exists {dest.relative_to(REAL)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=120) as r, open(part, "wb") as f:
                shutil.copyfileobj(r, f, length=1 << 20)
            part.replace(dest)
            log("download", f"saved {dest.relative_to(REAL)} {dest.stat().st_size / 1e6:.1f} MB in {time.time() - t0:.0f}s")
            return
        except Exception as e:  # network hiccups are retried; a hard failure is reported, not fatal
            log("download", f"attempt {attempt} failed for {url}: {e}")
            time.sleep(10 * attempt)
    raise RuntimeError(f"could not download {url}")


def extract(archive, into, marker):
    if (into / marker).exists():
        return
    log("download", f"extracting {archive.name}")
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(into)
    else:
        with tarfile.open(archive) as t:
            t.extractall(into, filter="data")
    (into / marker).write_text("ok")


def nus_sms():
    """NUS SMS corpus (English) — JSON from the authors' GitHub repository."""
    dest = REAL / "sms_nus" / "smsCorpus_en.json"
    if dest.exists():
        return
    api = "https://api.github.com/repos/kite1988/nus-sms-corpus/contents/"
    try:
        req = urllib.request.Request(api, headers=UA)
        listing = json.loads(urllib.request.urlopen(req, timeout=60).read())
        log("download", "NUS repo files: " + ", ".join(x["name"] for x in listing)[:300])
        cand = [x for x in listing if "en" in x["name"].lower() and x["name"].endswith((".json", ".zip"))]
        if not cand:
            raise RuntimeError("no English corpus file found in repo")
        target = sorted(cand, key=lambda x: -x.get("size", 0))[0]
        raw = REAL / "sms_nus" / target["name"]
        fetch(target["download_url"], raw)
        if raw.suffix == ".zip":
            with zipfile.ZipFile(raw) as z:
                name = [n for n in z.namelist() if n.endswith(".json")][0]
                dest.write_bytes(z.read(name))
        else:
            raw.replace(dest)
    except Exception as e:
        log("download", f"NUS SMS unavailable ({e}); continuing without it")


def rvl_cdip():
    from huggingface_hub import hf_hub_download
    out = REAL / "rvl_cdip"
    out.mkdir(parents=True, exist_ok=True)
    shards = ["data/test-00000-of-00015.parquet"] if SMOKE else [
        f"data/test-0000{i}-of-00015.parquet" for i in range(3)]
    for s in shards:
        if (out / s.split("/")[-1]).exists():
            continue
        p = hf_hub_download("chainyo/rvl-cdip", s, repo_type="dataset", local_dir=out)
        log("download", f"RVL-CDIP shard {p}")


def models():
    from huggingface_hub import hf_hub_download, snapshot_download
    snapshot_download("openai/whisper-small", allow_patterns=["*.json", "*.safetensors", "*.txt"])
    log("download", "whisper-small ready")
    for v in PIPER_VOICES[: 2 if SMOKE else None]:
        for ext in (".onnx", ".onnx.json"):
            hf_hub_download("rhasspy/piper-voices", v + ext, local_dir=PIPER_DIR)
    log("download", "piper voices ready")
    import easyocr
    easyocr.Reader(["en"], gpu=True, model_storage_directory=str(EASYOCR_DIR), verbose=False)
    log("download", "easyocr ready")


def safe(label, fn, *a):
    """A failed dataset is logged and skipped — it must not stop the others."""
    try:
        fn(*a)
        return True
    except Exception as e:
        log("download", f"FAILED {label}: {e}")
        return False


def enron():
    """CMU tarball (resumed separately with curl into a .dl file); Hugging Face copy as fallback."""
    final = REAL / "enron" / "enron_mail_20150507.tar.gz"
    pending = REAL / "enron" / "enron_mail_20150507.tar.gz.dl"
    waited = 0
    while not final.exists() and pending.exists() and waited < 45 * 60:
        time.sleep(30)
        waited += 30
        if waited % 300 == 0:
            log("download", f"waiting for Enron resume: {pending.stat().st_size / 1e6:.0f} MB so far")
    if final.exists():
        extract(final, REAL / "enron", ".extracted")
        return
    log("download", "Enron tarball unavailable — using the Hugging Face copy (corbt/enron-emails)")
    from huggingface_hub import hf_hub_download
    for i in range(3):
        hf_hub_download("corbt/enron-emails", f"data/train-0000{i}-of-00003.parquet", repo_type="dataset",
                        local_dir=REAL / "enron" / "hf")


def main():
    safe("models", models)
    for rel, url in FILES.items():
        if (SMOKE and rel in SMOKE_SKIP) or rel.startswith("enron/"):
            continue
        safe(rel, fetch, url, REAL / rel)
    safe("nus_sms", nus_sms)
    safe("rvl_cdip", rvl_cdip)
    # unpack what needs unpacking
    safe("uci", extract, REAL / "sms_uci/smsspamcollection.zip", REAL / "sms_uci", ".extracted")
    for a in sorted((REAL / "spamassassin").glob("*.tar.bz2")):
        safe(a.name, extract, a, REAL / "spamassassin", f".{a.stem}.extracted")
    safe("funsd", extract, REAL / "funsd/dataset.zip", REAL / "funsd", ".extracted")
    if not SMOKE:
        safe("coco", extract, REAL / "coco/val2017.zip", REAL / "coco", ".extracted")
        safe("librispeech", extract, REAL / "librispeech/test-clean.tar.gz", REAL / "librispeech", ".extracted")
        safe("enron", enron)
    log("download", "stage complete")


if __name__ == "__main__":
    main()

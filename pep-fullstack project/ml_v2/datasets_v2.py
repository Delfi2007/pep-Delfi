"""Assemble the v2 training / validation / test sets from every source.

Conversation format (same as v1 / ml/common.py):
    {"id", "messages": [(author, text), ...], "predators": [author] or [],
     "modality", "origin", "extra_text" (video transcript), "label"}

Train  = PAN12 train split  + synthetic pool A (all modalities, converted to text)
         + real non-grooming text (Enron, SMS, spam, phishing, scanned documents; train split)
Val    = PAN12 validation split (unseen predators)  + 10% of synthetic pool A
Test   = PAN12 official test set  +  synthetic pool B per modality  +  real held-out text
"""
import hashlib
import json

from common import load, split_train_val
from config import DERIVED, SMOKE, SYN, rng

SYN_CAPS = {"chat": 15_000, "sms": 5_000, "email": 5_000}   # keep PAN12 the dominant training signal
REAL_TRAIN_CAP = 30_000


def _read(path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f]


def to_conv(rec, modality=None, origin="synthetic"):
    msgs = [(str(a), str(t)) for a, t in rec.get("messages", []) if str(t).strip()]
    pred = rec.get("predator")
    authors = {a for a, _ in msgs}
    return {"id": rec["id"], "messages": msgs,
            "predators": [pred] if rec.get("label") and pred in authors else [],
            "label": int(bool(rec.get("label"))),
            "modality": modality or rec.get("modality", "chat"), "origin": origin,
            "extra_text": rec.get("transcript", ""), "source": rec.get("source", "synthetic")}


def synthetic(pool):
    out = []
    caps = {} if pool == "B" else SYN_CAPS
    for name, modality in (("chats", "chat"), ("sms", "sms"), ("email", "email")):
        rows = _read(SYN / f"{name}_{pool}.jsonl")
        if modality in caps:
            rows = rows[: caps[modality]]
        out += [to_conv(r, modality) for r in rows]
    for name in ("docs", "screens", "voice", "video"):
        out += [to_conv(r) for r in _read(DERIVED / f"{name}_{pool}.jsonl")]
    return [c for c in out if c["messages"]]


def real(split):
    rows = _read(DERIVED / "real_text.jsonl") + _read(DERIVED / "rvl_ocr.jsonl")
    rows = [r for r in rows if r.get("split") == split]
    if split == "train" and len(rows) > REAL_TRAIN_CAP:
        rng(9).shuffle(rows)
        rows = rows[:REAL_TRAIN_CAP]
    return [to_conv(r, r.get("modality"), origin="real") for r in rows]


def _is_val(cid):
    return int(hashlib.md5(cid.encode()).hexdigest(), 16) % 10 == 0


def build():
    pan_train = load("train")
    pan_test = load("test")
    tr, val = split_train_val(pan_train["conversations"])
    for c in tr + val + pan_test["conversations"]:
        c.setdefault("modality", "chat")
        c.setdefault("origin", "pan12")
        c.setdefault("extra_text", "")
        c["label"] = int(bool(c["predators"]))
    if SMOKE:
        r = rng(3)
        tr = r.sample(tr, 3000) + [c for c in tr if c["predators"]][:300]
        val = r.sample(val, 1500) + [c for c in val if c["predators"]][:100]
        tc = r.sample(pan_test["conversations"], 4000) + [c for c in pan_test["conversations"] if c["predators"]][:200]
        present = {a for c in tc for a, _ in c["messages"]}
        pan_test = {"conversations": tc, "predators": {p for p in pan_test["predators"] if p in present}}
    syn_a = synthetic("A")
    syn_tr = [c for c in syn_a if not _is_val(c["id"])]
    syn_val = [c for c in syn_a if _is_val(c["id"])]
    real_tr = real("train")
    return {
        "pan_train": tr, "pan_val": val, "pan_test": pan_test,
        "syn_train": syn_tr, "syn_val": syn_val, "syn_test": synthetic("B"),
        "real_train": real_tr, "real_test": real("test"),
    }


def conv_text_v2(c):
    text = "\n".join(t for _, t in c["messages"])
    if c.get("extra_text"):
        text += "\n" + c["extra_text"]
    return text

"""Shared paths and settings for the v2 multimodal pipeline.

Everything v2 writes lives in *_v2 folders, so the running ACPIA application
(backend/, frontend/, models/, results/, ml/) is never touched.

Set SMOKE=1 to run every stage on a tiny sample (used to test the pipeline
before the full unattended run).
"""
import os
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V2 = ROOT / "ml_v2"
DATA = ROOT / "data_v2"
REAL = DATA / "real"
SYN = DATA / "synthetic"
DERIVED = DATA / "derived"
MODELS = ROOT / "models_v2"
RESULTS = ROOT / "results_v2"
PROCESSED = ROOT / "data" / "processed"           # PAN12 pickles from v1 (read only)
CACHE = ROOT / ".cache"

SMOKE = os.environ.get("SMOKE") == "1"
SEED = 42

# Keep every model cache on D: — C: has only ~9 GB free.
os.environ.setdefault("HF_HOME", str(CACHE / "hf"))
os.environ.setdefault("TORCH_HOME", str(CACHE / "torch"))
os.environ.setdefault("XDG_CACHE_HOME", str(CACHE))
os.environ.setdefault("TMP", str(CACHE / "tmp"))
os.environ.setdefault("TEMP", str(CACHE / "tmp"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
EASYOCR_DIR = CACHE / "easyocr"
PIPER_DIR = CACHE / "piper"

for d in (REAL, SYN, DERIVED, MODELS, RESULTS, CACHE / "tmp", EASYOCR_DIR, PIPER_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- sizes
# Full run vs smoke test. Counts are per synthetic pool (A = train, B = test).
N = {
    "chats": 300 if SMOKE else 30_000,          # per pool -> 60k chats total
    "sms_threads": 50 if SMOKE else 5_000,       # per pool
    "email_threads": 50 if SMOKE else 5_000,     # per pool
    "documents": 20 if SMOKE else 5_000,         # per pool, each rendered as PDF and DOCX
    "screenshots": 10 if SMOKE else 3_000,       # per pool
    "voice_convs": 4 if SMOKE else 1_000,        # per pool (one voice note per message)
    "videos": 2 if SMOKE else 300,               # per pool
    "ocr_screens": 10 if SMOKE else 600,        # per pool, screenshots actually OCR'd
    "asr_voice": 4 if SMOKE else 300,            # per pool, voice conversations transcribed
    "asr_video": 2 if SMOKE else 100,            # per pool, videos transcribed + OCR.d
    "enron_emails": 300 if SMOKE else 60_000,    # parsed from the Enron corpus
    "librispeech_utts": 20 if SMOKE else 500,    # of 2,620 in test-clean (~1 hour of speech)
    "funsd_docs": 3 if SMOKE else 50,            # FUNSD test set = 50
    "rvl_docs": 10 if SMOKE else 500,            # RVL-CDIP pages OCR'd as real documents
    "coco_images": 20 if SMOKE else 500,         # COCO photos used in the hashing test
}


def rng(salt=0):
    return random.Random(SEED + salt)


def log(stage, msg):
    line = f"[{stage}] {msg}"
    print(line, flush=True)

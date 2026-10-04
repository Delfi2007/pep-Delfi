"""Re-score the already fine-tuned DistilBERT (from pep-Delfi) with the shared evaluation,
so it gets the same curves / calibration / operating-point sweep as the other models.
Also evaluates a simple ensemble: mean of DistilBERT and TF-IDF+LR probabilities.

    ..\\.venv\\Scripts\\python eval_distilbert.py

Needs models/distilbert/{stage1,stage2} (copied from pep-Delfi, or produced by
train_distilbert.py) and, for the ensemble, models/tfidf_lr.joblib.
"""
import hashlib
import os
import time

import joblib
import numpy as np
import torch
from transformers import AutoModelForSequenceClassification

from common import ROOT, conv_text, load, split_train_val
from evaluate import full_evaluation
from train_distilbert import DEVICE, predict

MODEL_DIR = ROOT / "models" / "distilbert"


def load_stage(name):
    m = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR / name).to(DEVICE)
    m.eval()
    return m


def dir_size_mb(path):
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / 1e6


def main():
    print("device:", DEVICE, torch.cuda.get_device_name(0) if DEVICE == "cuda" else "", flush=True)
    train_all, test = load("train"), load("test")
    _, val = split_train_val(train_all["conversations"])
    stage1, stage2 = load_stage("stage1"), load_stage("stage2")

    cache = {}

    def score2(texts):
        keys = [hashlib.md5(t.encode("utf-8", "ignore")).hexdigest() for t in texts]
        todo = [(k, t) for k, t in zip(keys, texts) if k not in cache]
        if todo:
            uniq = dict(todo)
            probs = predict(stage2, list(uniq.values()))
            cache.update(zip(uniq.keys(), probs))
        return np.array([cache[k] for k in keys])

    t0 = time.perf_counter()
    test_texts = [conv_text(c) for c in test["conversations"]]
    p1_test = predict(stage1, test_texts)
    ms_per_conv = (time.perf_counter() - t0) * 1000 / len(test_texts)
    p1_val = predict(stage1, [conv_text(c) for c in val])
    print(f"stage 1 scored ({ms_per_conv:.2f} ms/conversation)", flush=True)

    full_evaluation(
        "distilbert", "DistilBERT (fine-tuned)", "transformer", val, test, p1_val, p1_test, score2,
        extra={"train_seconds": 469, "stage1_ms_per_conversation": round(ms_per_conv, 4),
               "model_size_mb": round(dir_size_mb(MODEL_DIR), 1), "device": DEVICE,
               "note": "Fine-tuned in pep-Delfi (train_distilbert.py); re-scored here."})

    lr_path = ROOT / "models" / "tfidf_lr.joblib"
    if not lr_path.exists():
        print("tfidf_lr.joblib missing — skipping ensemble")
        return
    lr = joblib.load(lr_path)

    def score2_ens(texts):
        if not len(texts):
            return []
        return (score2(texts) + lr["stage2"].predict_proba(texts)[:, 1]) / 2

    lr_p1_test = lr["stage1"].predict_proba(test_texts)[:, 1]
    lr_p1_val = lr["stage1"].predict_proba([conv_text(c) for c in val])[:, 1]
    full_evaluation(
        "ensemble", "Ensemble (DistilBERT + TF-IDF LR)", "ensemble", val, test,
        (p1_val + lr_p1_val) / 2, (p1_test + lr_p1_test) / 2, score2_ens,
        extra={"train_seconds": 469 + 37, "stage1_ms_per_conversation": round(ms_per_conv, 4),
               "model_size_mb": round(dir_size_mb(MODEL_DIR) + os.path.getsize(lr_path) / 1e6, 1),
               "device": DEVICE, "note": "Unweighted mean of the two models' probabilities at each stage."})


if __name__ == "__main__":
    main()

"""Shared data loading, two-stage pipeline glue and metrics for PAN12.

Stage 1 (SCI)  - conversation classifier: does this chat contain grooming?
Stage 2 (VFP)  - author classifier inside a chat: is this participant the predator
                 (as opposed to the victim/decoy who may use similar words)?
Final          - author-level decision (official PAN12 Problem 1): an author is flagged
                 if, in any conversation, stage1 >= t1 and their stage2 score >= t2.
"""
import hashlib
import json
import pickle
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix,
                             fbeta_score, precision_score, recall_score, roc_auc_score)

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
RESULTS = ROOT / "results_v2"
SEED = 42


def load(split):
    with open(PROCESSED / f"{split}.pkl", "rb") as f:
        return pickle.load(f)


def split_train_val(convs, val_frac=0.2):
    """Group-aware split: every conversation of a given predator lands on the same side,
    so validation predators are unseen during training (like the real test set)."""
    def bucket(key):
        return int(hashlib.md5(key.encode()).hexdigest(), 16) % 1000 / 1000
    train, val = [], []
    for c in convs:
        key = c["predators"][0] if c["predators"] else c["id"]
        (val if bucket(key) < val_frac else train).append(c)
    return train, val


def conv_text(c):
    return "\n".join(t for _, t in c["messages"])


def authors_of(c):
    return sorted({a for a, _ in c["messages"]})


def author_text(c, author):
    return "\n".join(t for a, t in c["messages"] if a == author)


def stage2_examples(convs):
    """(text, label) per author in predator-containing conversations."""
    texts, labels = [], []
    for c in convs:
        if not c["predators"]:
            continue
        for a in authors_of(c):
            texts.append(author_text(c, a))
            labels.append(int(a in c["predators"]))
    return texts, labels


def downsample_negatives(convs, ratio, seed=SEED):
    pos = [c for c in convs if c["predators"]]
    neg = [c for c in convs if not c["predators"]]
    random.Random(seed).shuffle(neg)
    return pos + neg[: ratio * len(pos)]


# ---------------------------------------------------------------- metrics

def binary_metrics(y_true, y_pred, y_score=None):
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    m = {
        "n": int(len(y_true)),
        "positives": int(y_true.sum()),
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": fbeta_score(y_true, y_pred, beta=1, zero_division=0),
        "f0.5": fbeta_score(y_true, y_pred, beta=0.5, zero_division=0),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }
    if y_score is not None and 0 < y_true.sum() < len(y_true):
        m["roc_auc"] = roc_auc_score(y_true, y_score)
        m["pr_auc"] = average_precision_score(y_true, y_score)
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}


# ---------------------------------------------------------------- pipeline glue

def author_scores(convs, p1, score2_fn, t1):
    """For every conversation with stage1 prob >= t1, score its authors with stage 2.
    Returns {author: max over flagged convs of (stage2 score)}."""
    flagged = [c for c, p in zip(convs, p1) if p >= t1]
    pairs = [(c, a) for c in flagged for a in authors_of(c)]
    scores = score2_fn([author_text(c, a) for c, a in pairs]) if pairs else []
    best = defaultdict(float)
    for (c, a), s in zip(pairs, scores):
        best[a] = max(best[a], float(s))
    return best


def author_level(convs, predators, best, t2):
    all_authors = sorted({a for c in convs for a in authors_of(c)})
    y_true = [int(a in predators) for a in all_authors]
    y_pred = [int(best.get(a, 0.0) >= t2) for a in all_authors]
    y_score = [best.get(a, 0.0) for a in all_authors]
    return binary_metrics(y_true, y_pred, y_score)


def tune_thresholds(val_convs, val_predators, p1, score2_fn,
                    t1_grid=(0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999),
                    t2_grid=(0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995)):
    """Grid-search t1/t2 on validation to maximise author-level F0.5 (the PAN12 metric).
    Stage 2 is scored once at the lowest t1, then reused for higher t1."""
    t1_min = min(t1_grid)
    flagged = [(c, p) for c, p in zip(val_convs, p1) if p >= t1_min]
    pairs = [(c, p, a) for c, p in flagged for a in authors_of(c)]
    s2 = score2_fn([author_text(c, a) for c, _, a in pairs]) if pairs else []
    best_cfg, best_f = None, -1
    for t1 in t1_grid:
        best = defaultdict(float)
        for (c, p, a), s in zip(pairs, s2):
            if p >= t1:
                best[a] = max(best[a], float(s))
        for t2 in t2_grid:
            m = author_level(val_convs, val_predators, best, t2)
            if m["f0.5"] > best_f:
                best_f, best_cfg = m["f0.5"], {"t1": t1, "t2": t2, "val_author": m}
    return best_cfg


def evaluate_and_save(name, test, p1_test, score2_fn, cfg, extra=None):
    """Compute all test metrics, write results/<name>.json and return them."""
    convs, predators = test["conversations"], test["predators"]
    y_conv = [int(bool(c["predators"])) for c in convs]
    stage1 = binary_metrics(y_conv, [int(p >= cfg["t1"]) for p in p1_test], p1_test)

    # stage 2 in isolation: gold predator conversations, classify each participant
    texts, labels = stage2_examples(convs)
    s2 = score2_fn(texts)
    stage2 = binary_metrics(labels, [int(s >= 0.5) for s in s2], s2)

    best = author_scores(convs, p1_test, score2_fn, cfg["t1"])
    final = author_level(convs, predators, best, cfg["t2"])

    out = {
        "model": name,
        "thresholds": {"t1_stage1": cfg["t1"], "t2_stage2": cfg["t2"]},
        "validation_author_level": cfg["val_author"],
        "test_stage1_conversation": stage1,
        "test_stage2_predator_vs_victim": stage2,
        "test_final_author_level_PAN12": final,
        **(extra or {}),
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(out, indent=2))
    return out

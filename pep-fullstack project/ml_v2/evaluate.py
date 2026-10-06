"""One evaluation routine shared by every model, so the comparison is apples to apples.

Protocol (unchanged from the original pep-Delfi experiments):
  1. thresholds t1 / t2 are tuned on a group-aware validation split (unseen predators)
     to maximise author-level F0.5, the official PAN12 metric;
  2. they are frozen, and only then is the official PAN12 test set scored.

Writes results/<name>.json with metrics, curves, calibration and an operating-point sweep.
"""
import json
import time
from collections import defaultdict

from common import (RESULTS, author_level, authors_of, author_text, binary_metrics,
                    conv_text, stage2_examples, tune_thresholds)
from metrics_extra import author_sweep, calibration, curves


def _best_author_scores(convs, p1, score2_fn, t1):
    flagged = [c for c, p in zip(convs, p1) if p >= t1]
    pairs = [(c, a) for c in flagged for a in authors_of(c)]
    scores = score2_fn([author_text(c, a) for c, a in pairs]) if pairs else []
    best = defaultdict(float)
    for (c, a), s in zip(pairs, scores):
        best[a] = max(best[a], float(s))
    return best


def full_evaluation(name, label, family, val, test, p1_val, p1_test, score2_fn, extra=None):
    """Tune on validation, evaluate on test, save and return the result dict."""
    val_predators = {p for c in val for p in c["predators"]}
    cfg = tune_thresholds(val, val_predators, p1_val, score2_fn)
    t1, t2 = cfg["t1"], cfg["t2"]
    print(f"[{name}] tuned t1={t1} t2={t2} val F0.5={cfg['val_author']['f0.5']}", flush=True)

    convs, predators = test["conversations"], test["predators"]

    # Stage 1 — conversation level
    y_conv = [int(bool(c["predators"])) for c in convs]
    stage1 = binary_metrics(y_conv, [int(p >= t1) for p in p1_test], p1_test)
    stage1_at_05 = binary_metrics(y_conv, [int(p >= 0.5) for p in p1_test], p1_test)

    # Stage 2 — predator vs victim, inside gold predator conversations
    texts, labels = stage2_examples(convs)
    t0 = time.perf_counter()
    s2 = score2_fn(texts)
    s2_ms = (time.perf_counter() - t0) * 1000 / max(1, len(texts))
    stage2 = binary_metrics(labels, [int(s >= 0.5) for s in s2], s2)

    # Final — author level (PAN12 Problem 1)
    best = _best_author_scores(convs, p1_test, score2_fn, t1)
    final = author_level(convs, predators, best, t2)
    all_authors = sorted({a for c in convs for a in authors_of(c)})
    y_auth = [int(a in predators) for a in all_authors]
    s_auth = [best.get(a, 0.0) for a in all_authors]

    out = {
        "model": name,
        "label": label,
        "family": family,
        "thresholds": {"t1_stage1": t1, "t2_stage2": t2},
        "validation_author_level": cfg["val_author"],
        "test_stage1_conversation": stage1,
        "test_stage1_conversation_at_0.5": stage1_at_05,
        "test_stage2_predator_vs_victim": stage2,
        "test_final_author_level_PAN12": final,
        "curves": {
            "stage1": curves(y_conv, p1_test),
            "stage2": curves(labels, s2),
            "author": curves(y_auth, s_auth),
        },
        "calibration": {
            "stage1": calibration(y_conv, p1_test),
            "stage2": calibration(labels, s2),
        },
        "operating_points": author_sweep(convs, predators, best),
        "stage2_ms_per_author_doc": round(s2_ms, 4),
        **(extra or {}),
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(out, indent=2))
    f = final
    print(f"[{name}] TEST author: P={f['precision']} R={f['recall']} F1={f['f1']} "
          f"F0.5={f['f0.5']} acc={f['accuracy']}", flush=True)
    return out


def conv_texts(convs):
    return [conv_text(c) for c in convs]

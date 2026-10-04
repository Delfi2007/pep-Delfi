"""Extra evaluation used by every model so results are directly comparable:

- ROC / PR curves, down-sampled to a fixed number of points for the frontend
- probability calibration: ECE, Brier score and a reliability diagram
  (motivated by the CARE paper, research_papers/ACPIA_10: a detector's scores
  must be trustworthy probabilities, not just a good ranking)
- an author-level operating-point sweep, so the UI can show the
  precision / recall trade-off when an investigator moves the threshold
"""
import numpy as np
from sklearn.metrics import brier_score_loss, precision_recall_curve, roc_curve

from common import author_level


def _downsample(xs, ys, n=120):
    xs, ys = np.asarray(xs), np.asarray(ys)
    if len(xs) <= n:
        return [round(float(x), 4) for x in xs], [round(float(y), 4) for y in ys]
    idx = np.unique(np.linspace(0, len(xs) - 1, n).astype(int))
    return [round(float(x), 4) for x in xs[idx]], [round(float(y), 4) for y in ys[idx]]


def curves(y_true, y_score):
    y_true, y_score = np.asarray(y_true), np.asarray(y_score)
    fpr, tpr, _ = roc_curve(y_true, y_score)
    prec, rec, _ = precision_recall_curve(y_true, y_score)
    fx, fy = _downsample(fpr, tpr)
    rx, ry = _downsample(rec[::-1], prec[::-1])
    return {"roc": {"fpr": fx, "tpr": fy}, "pr": {"recall": rx, "precision": ry}}


def calibration(y_true, y_score, bins=10):
    """Expected Calibration Error with equal-width bins + Brier score."""
    y_true, y_score = np.asarray(y_true, dtype=float), np.clip(np.asarray(y_score, dtype=float), 0, 1)
    edges = np.linspace(0, 1, bins + 1)
    which = np.clip(np.digitize(y_score, edges[1:-1]), 0, bins - 1)
    table, ece = [], 0.0
    for b in range(bins):
        m = which == b
        if not m.any():
            continue
        conf, acc, cnt = float(y_score[m].mean()), float(y_true[m].mean()), int(m.sum())
        ece += cnt / len(y_true) * abs(acc - conf)
        table.append({"bin": round(float(edges[b]), 2), "confidence": round(conf, 4),
                      "accuracy": round(acc, 4), "count": cnt})
    return {"ece": round(ece, 4), "brier": round(float(brier_score_loss(y_true, y_score)), 4),
            "reliability": table}


def author_sweep(convs, predators, best,
                 t2_grid=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995)):
    """Author-level metrics at the tuned t1 for a range of t2 values.
    `best` is {author: max stage-2 score over conversations flagged at t1}."""
    out = []
    for t2 in t2_grid:
        m = author_level(convs, predators, best, t2)
        out.append({"t2": t2, "precision": m["precision"], "recall": m["recall"], "f1": m["f1"],
                    "f0.5": m["f0.5"], "tp": m["confusion_matrix"]["tp"], "fp": m["confusion_matrix"]["fp"]})
    return out

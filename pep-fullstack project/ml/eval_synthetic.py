"""Out-of-domain sanity check on the synthetic chats (data/synthetic/synthetic_eval.json).

Every model was trained only on PAN12 (2000s-era English IRC-style chats). The synthetic
set is written in a different, modern messaging style, so this measures *transfer*, in the
spirit of the distribution-shift analysis in research_papers/ACPIA_10 (CARE).
It is a sanity check, not a benchmark: template data is far easier and narrower than real chats.

    ..\\.venv\\Scripts\\python eval_synthetic.py
"""
import json

import joblib
import numpy as np

from common import RESULTS, ROOT, binary_metrics

MODELS = ["tfidf_lr", "tfidf_svm", "tfidf_cnb", "char_lr", "behavioral_hgb", "distilbert", "ensemble",
          "tfidf_cnb_aug", "tfidf_lr_aug"]


def conv_text(msgs):
    return "\n".join(t for _, t in msgs)


def author_text(msgs, a):
    return "\n".join(t for x, t in msgs if x == a)


_BERT = {}


def _bert():
    if not _BERT:
        from transformers import AutoModelForSequenceClassification
        from train_distilbert import DEVICE, predict
        d = ROOT / "models" / "distilbert"
        _BERT["s1"] = AutoModelForSequenceClassification.from_pretrained(d / "stage1").to(DEVICE).eval()
        _BERT["s2"] = AutoModelForSequenceClassification.from_pretrained(d / "stage2").to(DEVICE).eval()
        _BERT["predict"] = predict
    return _BERT


def load_scorers(name):
    if name in ("distilbert", "ensemble"):
        b = _bert()
        t = json.loads((RESULTS / f"{name}.json").read_text())["thresholds"]
        s1 = lambda x: b["predict"](b["s1"], x)  # noqa: E731
        s2 = lambda x: b["predict"](b["s2"], x)  # noqa: E731
        if name == "distilbert":
            return s1, s2, t["t1_stage1"]
        lr = joblib.load(ROOT / "models" / "tfidf_lr.joblib")
        return ((lambda x: (s1(x) + lr["stage1"].predict_proba(x)[:, 1]) / 2),
                (lambda x: (s2(x) + lr["stage2"].predict_proba(x)[:, 1]) / 2), t["t1_stage1"])
    b = joblib.load(ROOT / "models" / f"{name}.joblib")
    return (lambda x: b["stage1"].predict_proba(x)[:, 1]), (lambda x: b["stage2"].predict_proba(x)[:, 1]), b["t1"]


def main():
    data = json.loads((ROOT / "data" / "synthetic" / "synthetic_eval.json").read_text())["conversations"]
    y = [c["label"] for c in data]
    texts = [conv_text(c["messages"]) for c in data]
    out = {}
    for name in MODELS:
        try:
            s1, s2, t1 = load_scorers(name)
        except (FileNotFoundError, OSError):
            print("skip", name)
            continue
        p = np.asarray(s1(texts))
        m_tuned = binary_metrics(y, (p >= t1).astype(int), p)
        m_05 = binary_metrics(y, (p >= 0.5).astype(int), p)
        # stage 2: in grooming-pattern chats, is the adult account ranked as the instigator?
        hits = 0
        pos = [c for c in data if c["label"]]
        for c in pos:
            authors = sorted({a for a, _ in c["messages"]})
            scores = s2([author_text(c["messages"], a) for a in authors])
            hits += authors[int(np.argmax(scores))] == c["predator"]
        out[name] = {"at_tuned_t1": m_tuned, "at_0.5": m_05, "t1": t1,
                     "stage2_instigator_accuracy": round(hits / len(pos), 4)}
        print(f"{name:15s} AUC={m_05.get('roc_auc')}  F1@0.5={m_05['f1']}  F1@t1={m_tuned['f1']}  "
              f"instigator-acc={out[name]['stage2_instigator_accuracy']}")
    (RESULTS / "synthetic_eval.json").write_text(json.dumps({
        "description": "Evaluation on 600 synthetic modern-style chats from phrase pool B "
                       "(150 grooming-pattern, 450 benign incl. adult-dating hard negatives). "
                       "PAN12-only models never saw synthetic data; *_aug models were trained on "
                       "PAN12 + pool A, whose phrase templates are disjoint from pool B.",
        "results": out}, indent=2))


if __name__ == "__main__":
    main()

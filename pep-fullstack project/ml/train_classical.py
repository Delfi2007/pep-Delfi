"""Train and evaluate the CPU-friendly models on PAN12, all with the same two-stage pipeline.

    ..\\.venv\\Scripts\\python train_classical.py              # all models
    ..\\.venv\\Scripts\\python train_classical.py tfidf_svm    # just one

Models
  tfidf_lr        word 1-2-gram TF-IDF + Logistic Regression   (original pep-Delfi baseline)
  tfidf_svm       word 1-2-gram TF-IDF + Linear SVM, sigmoid-calibrated
                  (the lightweight-triage recipe of research_papers/ACPIA_07)
  tfidf_cnb       word 1-2-gram TF-IDF + Complement Naive Bayes
  char_lr         character 2-5-gram TF-IDF + Logistic Regression (robust to misspelling / leetspeak)
  behavioral_hgb  interpretable behavioural signals (ml_signals.py) + Histogram Gradient Boosting
  tfidf_cnb_aug   Complement NB trained on PAN12 + synthetic pool A   (domain adaptation)
  tfidf_lr_aug    Logistic Regression trained on PAN12 + synthetic pool A
"""
import json
import pickle
import sys
import time

import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer
from sklearn.svm import LinearSVC

from common import ROOT, SEED, conv_text, load, split_train_val, stage2_examples
from evaluate import full_evaluation
from ml_signals import feature_matrix


def word_tfidf():
    return TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=3, max_features=300_000,
                           sublinear_tf=True, token_pattern=r"(?u)\b\w+\b")


def char_tfidf():
    return TfidfVectorizer(lowercase=True, analyzer="char_wb", ngram_range=(2, 5), min_df=5,
                           max_features=300_000, sublinear_tf=True)


MODELS = {
    "tfidf_lr": {
        "label": "TF-IDF + Logistic Regression",
        "family": "linear",
        "build": lambda: make_pipeline(word_tfidf(), LogisticRegression(
            C=4.0, class_weight="balanced", max_iter=2000, solver="liblinear")),
    },
    "tfidf_svm": {
        "label": "TF-IDF + Linear SVM (calibrated)",
        "family": "linear",
        "build": lambda: make_pipeline(word_tfidf(), CalibratedClassifierCV(
            LinearSVC(C=0.5, class_weight="balanced", random_state=SEED), method="sigmoid", cv=3)),
    },
    "tfidf_cnb": {
        "label": "TF-IDF + Complement Naive Bayes",
        "family": "probabilistic",
        "build": lambda: make_pipeline(word_tfidf(), ComplementNB(alpha=0.3)),
    },
    "char_lr": {
        "label": "Char n-gram TF-IDF + Logistic Regression",
        "family": "linear",
        "build": lambda: make_pipeline(char_tfidf(), LogisticRegression(
            C=4.0, class_weight="balanced", max_iter=2000, solver="liblinear")),
    },
    "behavioral_hgb": {
        "label": "Behavioural signals + Gradient Boosting",
        "family": "tree / interpretable",
        "build": lambda: make_pipeline(
            FunctionTransformer(feature_matrix),
            HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
                                           class_weight="balanced", random_state=SEED)),
    },
    # Domain adaptation: same recipes, trained on PAN12 + synthetic pool A (modern messaging style).
    # Thresholds are still tuned on PAN12 validation and scored on the PAN12 test set, so the
    # benchmark numbers stay comparable; transfer is measured on the disjoint pool B.
    "tfidf_cnb_aug": {
        "label": "TF-IDF + Complement NB (PAN12 + synthetic)",
        "family": "probabilistic · domain-adapted",
        "augment": True,
        "build": lambda: make_pipeline(word_tfidf(), ComplementNB(alpha=0.3)),
    },
    "tfidf_lr_aug": {
        "label": "TF-IDF + Logistic Regression (PAN12 + synthetic)",
        "family": "linear · domain-adapted",
        "augment": True,
        "build": lambda: make_pipeline(word_tfidf(), LogisticRegression(
            C=4.0, class_weight="balanced", max_iter=2000, solver="liblinear")),
    },
}

DEFAULT = ["tfidf_lr", "tfidf_svm", "tfidf_cnb", "char_lr", "behavioral_hgb", "tfidf_cnb_aug", "tfidf_lr_aug"]


def synthetic_train():
    """Synthetic pool A in the PAN12 conversation format."""
    data = json.loads((ROOT / "data" / "synthetic" / "synthetic_train.json").read_text())["conversations"]
    return [{"id": c["id"], "messages": [tuple(m) for m in c["messages"]],
             "predators": [c["predator"]] if c["predator"] else []} for c in data]


def run(name, tr, val, test):
    spec = MODELS[name]
    if spec.get("augment"):
        tr = tr + synthetic_train()
    t0 = time.time()
    x1, y1 = [conv_text(c) for c in tr], [int(bool(c["predators"])) for c in tr]
    stage1 = spec["build"]().fit(x1, y1)
    x2, y2 = stage2_examples(tr)
    stage2 = spec["build"]().fit(x2, y2)
    train_seconds = round(time.time() - t0, 1)
    print(f"[{name}] trained in {train_seconds}s", flush=True)

    def score2(texts):
        return stage2.predict_proba(texts)[:, 1] if len(texts) else []

    test_texts = [conv_text(c) for c in test["conversations"]]
    t1 = time.perf_counter()
    p1_test = stage1.predict_proba(test_texts)[:, 1]
    ms_per_conv = (time.perf_counter() - t1) * 1000 / len(test_texts)
    p1_val = stage1.predict_proba([conv_text(c) for c in val])[:, 1]

    bundle = {"stage1": stage1, "stage2": stage2}
    size_mb = len(pickle.dumps(bundle)) / 1e6
    out = full_evaluation(
        name, spec["label"], spec["family"], val, test, p1_val, p1_test, score2,
        extra={"train_seconds": train_seconds, "stage1_ms_per_conversation": round(ms_per_conv, 4),
               "model_size_mb": round(size_mb, 2), "device": "cpu"})

    bundle.update({"t1": out["thresholds"]["t1_stage1"], "t2": out["thresholds"]["t2_stage2"],
                   "label": spec["label"]})
    (ROOT / "models").mkdir(exist_ok=True)
    joblib.dump(bundle, ROOT / "models" / f"{name}.joblib", compress=3)
    return out


def main():
    names = sys.argv[1:] or DEFAULT
    train_all, test = load("train"), load("test")
    tr, val = split_train_val(train_all["conversations"])
    print(f"train={len(tr):,} val={len(val):,} test={len(test['conversations']):,}", flush=True)
    for n in names:
        run(n, tr, val, test)


if __name__ == "__main__":
    main()

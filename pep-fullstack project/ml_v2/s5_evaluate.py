"""Stage 5 — evaluate every model per input type, and on real held-out text.

For v2 models (models_v2/) and, for comparison, the v1 models the app uses
(models/, read only):
  * detection per input type on synthetic pool B (never seen in training):
    chat, SMS, email, PDF, Word, screenshot (OCR), voice note (Whisper), video
    -> accuracy, precision, recall, F1, F0.5, ROC-AUC, PR-AUC at 0.5 and at tuned t1
  * instigator identification: in grooming-pattern conversations, is the adult
    account ranked above the child by stage 2?
  * false-alarm rate on REAL held-out text that contains no grooming:
    Enron email, SMS (UCI, NUS), spam, phishing, scanned documents (RVL-CDIP OCR)

Output: results_v2/multimodal_eval.json
"""
import json
import time
from collections import defaultdict

import joblib
import numpy as np

from common import binary_metrics
from config import MODELS, RESULTS, ROOT, SMOKE, log
from datasets_v2 import build, conv_text_v2

V1_MODELS = ROOT / "models"
TEST_CAP = 400 if SMOKE else 5000          # per input type, keeps the run short


def scorers(name, base):
    """(stage1_fn, stage2_fn, t1) for a model stored under `base`."""
    if name in ("distilbert", "ensemble"):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        from s4_train import predict
        d = base / "distilbert"
        if not (d / "stage1").exists():
            return None
        tok = AutoTokenizer.from_pretrained(d / "stage1")
        m1 = AutoModelForSequenceClassification.from_pretrained(d / "stage1").cuda().eval()
        m2 = AutoModelForSequenceClassification.from_pretrained(d / "stage2").cuda().eval()
        res = json.loads((base.parent / ("results_v2" if base == MODELS else "results") / f"{name}.json").read_text())
        t1 = res["thresholds"]["t1_stage1"]
        s1 = lambda x: predict(torch, tok, m1, x)  # noqa: E731
        s2 = lambda x: predict(torch, tok, m2, x)  # noqa: E731
        if name == "distilbert":
            return s1, s2, t1
        lr = joblib.load(base / "tfidf_lr.joblib")
        return ((lambda x: (s1(x) + lr["stage1"].predict_proba(x)[:, 1]) / 2),
                (lambda x: (s2(x) + lr["stage2"].predict_proba(x)[:, 1]) / 2), t1)
    p = base / f"{name}.joblib"
    if not p.exists():
        return None
    b = joblib.load(p)
    return (lambda x: b["stage1"].predict_proba(x)[:, 1]), (lambda x: b["stage2"].predict_proba(x)[:, 1]), b["t1"]


def author_text(c, a):
    return "\n".join(t for x, t in c["messages"] if x == a)


def evaluate_model(fns, syn_test, real_test):
    s1, s2, t1 = fns
    by_mod = defaultdict(list)
    for c in syn_test:
        by_mod[c["modality"]].append(c)
    out = {"per_input_type": {}, "false_alarms_real": {}, "t1": t1}
    for mod, convs in sorted(by_mod.items()):
        convs = convs[:TEST_CAP]
        y = [c["label"] for c in convs]
        if len(set(y)) < 2:
            continue
        p = np.asarray(s1([conv_text_v2(c) for c in convs]))
        # instigator: in grooming conversations, does stage 2 rank the adult first?
        hits = n = 0
        pos = [c for c in convs if c["label"] and c["predators"]]
        pairs = [(c, a) for c in pos for a in sorted({x for x, _ in c["messages"]})]
        if pairs:
            sc = np.asarray(s2([author_text(c, a) for c, a in pairs]))
            best = {}
            for (c, a), s in zip(pairs, sc):
                if c["id"] not in best or s > best[c["id"]][1]:
                    best[c["id"]] = (a, s)
            n = len(best)
            hits = sum(1 for c in pos if c["id"] in best and best[c["id"]][0] == c["predators"][0])
        out["per_input_type"][mod] = {
            "n": len(convs), "positives": int(sum(y)),
            "at_0.5": binary_metrics(y, (p >= 0.5).astype(int), p),
            "at_tuned_t1": binary_metrics(y, (p >= t1).astype(int), p),
            "instigator_accuracy": round(hits / n, 4) if n else None,
        }
    by_src = defaultdict(list)
    for c in real_test:
        key = c["source"].replace("uci_sms_ham", "sms_uci").replace("uci_sms_spam", "sms_spam_uci")
        key = "spam_email" if key.startswith("spamassassin_spam") else "ham_email" if key.startswith("spamassassin") else key
        by_src[key].append(c)
    for src, convs in sorted(by_src.items()):
        convs = convs[:TEST_CAP]
        p = np.asarray(s1([conv_text_v2(c) for c in convs]))
        out["false_alarms_real"][src] = {"n": len(convs), "fpr_at_0.5": round(float((p >= 0.5).mean()), 4),
                                         "fpr_at_tuned_t1": round(float((p >= t1).mean()), 4)}
    return out


def main():
    t0 = time.time()
    d = build()
    syn_test, real_test = d["syn_test"], d["real_test"]
    log("evaluate", f"synthetic test {len(syn_test):,}, real held-out {len(real_test):,}")
    results = {}
    names = ["tfidf_lr", "tfidf_svm", "tfidf_cnb", "char_lr", "behavioral_hgb", "distilbert", "ensemble"]
    for version, base, extra in (("v2", MODELS, []), ("v1", V1_MODELS, ["tfidf_cnb_aug", "tfidf_lr_aug"])):
        for name in names + extra:
            try:
                fns = scorers(name, base)
            except Exception as e:
                log("evaluate", f"{version}/{name}: could not load ({e})")
                continue
            if fns is None:
                continue
            t1 = time.time()
            results[f"{version}/{name}"] = evaluate_model(fns, syn_test, real_test)
            log("evaluate", f"{version}/{name} evaluated in {time.time() - t1:.0f}s")
            (RESULTS / "multimodal_eval.json").write_text(json.dumps(results, indent=2))
            import gc
            gc.collect()
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass
    log("evaluate", f"stage complete in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()

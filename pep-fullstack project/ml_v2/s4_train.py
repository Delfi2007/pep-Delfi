"""Stage 4 — train the v2 models on PAN12 + synthetic multimodal + real text.

Models (saved to models_v2/, results to results_v2/):
  tfidf_lr, tfidf_svm, tfidf_cnb, char_lr, behavioral_hgb   (classical, CPU)
  distilbert   stage 1 up to 4 epochs  (Devlin et al. 2019, App. A.3: 2-4 epochs)
               stage 2 up to 20 epochs (Mosbach et al. 2021: small datasets need more iterations)
               early stopping on validation F0.5, best epoch kept, every epoch logged
  ensemble     mean of distilbert and tfidf_lr

The PAN12 protocol is unchanged, so results stay comparable with v1: thresholds
are tuned on the PAN12 validation split (unseen predators), then the official
PAN12 test set is scored once (evaluate.full_evaluation).
"""
import json
import pickle
import random
import sys
import time

import joblib
import numpy as np

from common import SEED, author_text, authors_of, downsample_negatives, stage2_examples
from config import MODELS, RESULTS, ROOT, SMOKE, log, rng
from datasets_v2 import build, conv_text_v2
from evaluate import full_evaluation

# --------------------------------------------------------------------------- data
_D = None


def data():
    global _D
    if _D is None:
        t0 = time.time()
        _D = build()
        sizes = {k: (len(v["conversations"]) if isinstance(v, dict) else len(v)) for k, v in _D.items()}
        log("train", f"datasets built in {time.time() - t0:.0f}s: {sizes}")
        (RESULTS / "dataset_sizes_v2.json").write_text(json.dumps(sizes, indent=2))
    return _D


def cap_positive(convs, n, salt):
    pos = [c for c in convs if c["label"]]
    neg = [c for c in convs if not c["label"]]
    rng(salt).shuffle(pos)
    return pos[:n] + neg


def classical_train_sets():
    d = data()
    syn = cap_positive(d["syn_train"], 3000, 11)
    s1 = d["pan_train"] + syn + d["real_train"]
    x1 = [conv_text_v2(c) for c in s1]
    y1 = [c["label"] for c in s1]
    x2, y2 = stage2_examples(d["pan_train"] + syn)
    return x1, y1, x2, y2


# --------------------------------------------------------------------------- classical
def train_classical(names):
    sys.path.append(str(ROOT / "ml"))     # reuse the v1 model recipes from ml/train_classical.py (read only)
    from train_classical import MODELS as RECIPES
    d = data()
    x1, y1, x2, y2 = classical_train_sets()
    log("train", f"classical: stage1 {len(x1):,} texts ({sum(y1):,} positive), stage2 {len(x2):,} author texts")
    test_texts = [conv_text_v2(c) for c in d["pan_test"]["conversations"]]
    val_texts = [conv_text_v2(c) for c in d["pan_val"]]
    for name in names:
        spec = RECIPES[name]
        t0 = time.time()
        stage1 = spec["build"]().fit(x1, y1)
        stage2 = spec["build"]().fit(x2, y2)
        train_s = round(time.time() - t0, 1)

        def score2(texts, m=stage2):
            return m.predict_proba(texts)[:, 1] if len(texts) else []

        t1 = time.perf_counter()
        p1_test = stage1.predict_proba(test_texts)[:, 1]
        ms = (time.perf_counter() - t1) * 1000 / len(test_texts)
        p1_val = stage1.predict_proba(val_texts)[:, 1]
        bundle = {"stage1": stage1, "stage2": stage2}
        out = full_evaluation(name, spec["label"] + " (v2)", spec["family"] + " · multimodal", d["pan_val"],
                              d["pan_test"], p1_val, p1_test, score2,
                              extra={"train_seconds": train_s, "stage1_ms_per_conversation": round(ms, 4),
                                     "model_size_mb": round(len(pickle.dumps(bundle)) / 1e6, 2), "device": "cpu",
                                     "training_texts_stage1": len(x1), "training_texts_stage2": len(x2)})
        bundle.update({"t1": out["thresholds"]["t1_stage1"], "t2": out["thresholds"]["t2_stage2"],
                       "label": spec["label"] + " (v2)"})
        joblib.dump(bundle, MODELS / f"{name}.joblib", compress=3)
        log("train", f"{name} done in {time.time() - t0:.0f}s")


# --------------------------------------------------------------------------- DistilBERT
MODEL_NAME = "distilbert-base-uncased"
MAX_LEN, HEAD = 256, 128


def bert_setup():
    import torch
    from transformers import AutoTokenizer
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    return torch, AutoTokenizer.from_pretrained(MODEL_NAME)


def encode(tok, texts):
    ids = tok(texts, add_special_tokens=False, truncation=False)["input_ids"]
    tail = MAX_LEN - 2 - HEAD
    out = []
    for x in ids:
        if len(x) > MAX_LEN - 2:
            x = x[:HEAD] + x[-tail:]
        out.append([tok.cls_token_id] + x + [tok.sep_token_id])
    return out


def collate(torch, tok, batch):
    seqs = [b[0] for b in batch]
    width = max(len(s) for s in seqs)
    ids = torch.full((len(seqs), width), tok.pad_token_id)
    mask = torch.zeros((len(seqs), width), dtype=torch.long)
    for i, s in enumerate(seqs):
        ids[i, : len(s)] = torch.tensor(s)
        mask[i, : len(s)] = 1
    return ids, mask, torch.tensor([b[1] for b in batch])


def predict(torch, tok, model, texts, batch=128):
    dev = next(model.parameters()).device
    enc = encode(tok, texts)
    order = np.argsort([len(e) for e in enc])
    probs = np.zeros(len(enc))
    model.eval()
    with torch.no_grad():
        for i in range(0, len(order), batch):
            idx = order[i: i + batch]
            ids, mask, _ = collate(torch, tok, [(enc[j], 0) for j in idx])
            with torch.autocast("cuda", dtype=torch.float16):
                logits = model(input_ids=ids.to(dev), attention_mask=mask.to(dev)).logits
            probs[idx] = torch.softmax(logits.float(), -1)[:, 1].cpu().numpy()
    return probs


def best_f05(y, p):
    from sklearn.metrics import average_precision_score, precision_recall_curve
    prec, rec, _ = precision_recall_curve(y, p)
    f = (1.25 * prec * rec) / np.maximum(0.25 * prec + rec, 1e-9)
    return float(np.max(f)), float(average_precision_score(y, p))


def fine_tune(torch, tok, stage, tr_texts, tr_labels, va_texts, va_labels, max_epochs, patience, lr, log_rows):
    """Fine-tune with per-epoch validation and early stopping; returns the best model."""
    from torch.utils.data import DataLoader
    from transformers import AutoModelForSequenceClassification
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=2).cuda()
    data_ = list(zip(encode(tok, tr_texts), tr_labels))
    loader = DataLoader(data_, batch_size=32, shuffle=True, collate_fn=lambda b: collate(torch, tok, b))
    pos = sum(tr_labels) / len(tr_labels)
    w = torch.tensor([1 / (1 - pos), 1 / pos], device="cuda")
    loss_fn = torch.nn.CrossEntropyLoss(weight=w / w.sum() * 2)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)     # AdamW = Adam with bias correction
    steps = max_epochs * len(loader)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, s / max(1, 0.1 * steps)) * max(0.0, (steps - s) / steps))   # 10% warm-up, linear decay
    scaler = torch.amp.GradScaler()
    best, best_state, bad = -1.0, None, 0
    for ep in range(1, max_epochs + 1):
        model.train()
        t0, total = time.time(), 0.0
        for ids, mask, y in loader:
            ids, mask, y = ids.cuda(), mask.cuda(), y.cuda()
            with torch.autocast("cuda", dtype=torch.float16):
                loss = loss_fn(model(input_ids=ids, attention_mask=mask).logits.float(), y)
            opt.zero_grad()
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item()
        f05, pr_auc = best_f05(va_labels, predict(torch, tok, model, va_texts))
        row = {"stage": stage, "epoch": ep, "train_loss": round(total / len(loader), 4),
               "val_best_f0.5": round(f05, 4), "val_pr_auc": round(pr_auc, 4), "seconds": round(time.time() - t0)}
        log_rows.append(row)
        (RESULTS / "distilbert_epochs_v2.json").write_text(json.dumps(log_rows, indent=2))
        log("train", f"{stage} epoch {ep}/{max_epochs}: {row}")
        if f05 > best + 1e-4:
            best, bad = f05, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            row["best"] = True
        else:
            bad += 1
            if bad >= patience:
                log("train", f"{stage}: early stop after epoch {ep} (best val F0.5 {best:.4f})")
                break
    model.load_state_dict(best_state)
    return model


def train_distilbert():
    torch, tok = bert_setup()
    d = data()
    rows = []
    syn = cap_positive(d["syn_train"], 3000, 12)
    r = rng(13)
    syn_s1 = r.sample(syn, min(15_000, len(syn)))
    real_s1 = r.sample(d["real_train"], min(5_000, len(d["real_train"])))
    s1 = downsample_negatives(d["pan_train"], ratio=8) + syn_s1 + real_s1
    random.Random(SEED).shuffle(s1)
    va1 = d["pan_val"] + d["syn_val"]
    x2, y2 = stage2_examples(d["pan_train"] + syn)
    vx2, vy2 = stage2_examples(d["pan_val"] + d["syn_val"])
    log("train", f"distilbert: stage1 {len(s1):,} texts, val {len(va1):,}; stage2 {len(x2):,} author texts, val {len(vx2):,}")
    t0 = time.time()
    m1 = fine_tune(torch, tok, "stage1", [conv_text_v2(c) for c in s1], [c["label"] for c in s1],
                   [conv_text_v2(c) for c in va1], [c["label"] for c in va1],
                   max_epochs=2 if SMOKE else 4, patience=1, lr=3e-5, log_rows=rows)
    m2 = fine_tune(torch, tok, "stage2", x2, y2, vx2, vy2,
                   max_epochs=2 if SMOKE else 20, patience=3, lr=2e-5, log_rows=rows)
    train_s = round(time.time() - t0)
    out_dir = MODELS / "distilbert"
    for name, m in (("stage1", m1), ("stage2", m2)):
        m.save_pretrained(out_dir / name)
        tok.save_pretrained(out_dir / name)

    def score2(texts):
        return predict(torch, tok, m2, texts) if len(texts) else []

    test_texts = [conv_text_v2(c) for c in d["pan_test"]["conversations"]]
    t1 = time.perf_counter()
    p1_test = predict(torch, tok, m1, test_texts)
    ms = (time.perf_counter() - t1) * 1000 / len(test_texts)
    p1_val = predict(torch, tok, m1, [conv_text_v2(c) for c in d["pan_val"]])
    size = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file()) / 1e6
    full_evaluation("distilbert", "DistilBERT (v2)", "transformer · multimodal", d["pan_val"], d["pan_test"],
                    p1_val, p1_test, score2,
                    extra={"train_seconds": train_s, "stage1_ms_per_conversation": round(ms, 4),
                           "model_size_mb": round(size, 1), "device": "cuda", "epochs": rows,
                           "training_texts_stage1": len(s1), "training_texts_stage2": len(x2)})
    # ensemble with the v2 TF-IDF logistic regression
    lr_b = joblib.load(MODELS / "tfidf_lr.joblib")

    def score2_ens(texts):
        return (score2(texts) + lr_b["stage2"].predict_proba(texts)[:, 1]) / 2 if len(texts) else []

    lr_test = lr_b["stage1"].predict_proba(test_texts)[:, 1]
    lr_val = lr_b["stage1"].predict_proba([conv_text_v2(c) for c in d["pan_val"]])[:, 1]
    full_evaluation("ensemble", "Ensemble: DistilBERT + TF-IDF LR (v2)", "ensemble · multimodal", d["pan_val"],
                    d["pan_test"], (p1_val + lr_val) / 2, (p1_test + lr_test) / 2, score2_ens,
                    extra={"train_seconds": train_s, "device": "cuda", "model_size_mb": round(size + 4, 1)})
    del m1, m2
    torch.cuda.empty_cache()


CLASSICAL = ["tfidf_lr", "tfidf_svm", "tfidf_cnb", "char_lr", "behavioral_hgb"]


def main(only=None):
    for name, fn in (("classical", lambda: train_classical(CLASSICAL)), ("distilbert", train_distilbert)):
        if only and name not in only:
            continue
        marker = MODELS / f".done_{name}"
        if marker.exists():
            log("train", f"skip {name} (done)")
            continue
        t0 = time.time()
        fn()
        marker.write_text(str(round(time.time() - t0)))
        log("train", f"{name} finished in {time.time() - t0:.0f}s")
    log("train", "stage complete")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)

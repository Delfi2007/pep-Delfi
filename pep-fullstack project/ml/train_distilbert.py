"""DistilBERT fine-tune for both stages (GPU, mixed precision).

    .venv/Scripts/python model/train_distilbert.py
"""
import random
import time

import numpy as np
import torch
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from common import (ROOT, SEED, conv_text, downsample_negatives, evaluate_and_save, load,
                    split_train_val, stage2_examples, tune_thresholds)

MODEL_NAME = "distilbert-base-uncased"
MAX_LEN = 256          # head + tail truncation
HEAD = 128
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
tok = AutoTokenizer.from_pretrained(MODEL_NAME)


def encode(texts):
    """Keep the first HEAD and last (MAX_LEN - 2 - HEAD) tokens of each text."""
    ids = tok(texts, add_special_tokens=False, truncation=False)["input_ids"]
    tail = MAX_LEN - 2 - HEAD
    out = []
    for x in ids:
        if len(x) > MAX_LEN - 2:
            x = x[:HEAD] + x[-tail:]
        out.append([tok.cls_token_id] + x + [tok.sep_token_id])
    return out


def collate(batch):
    seqs = [b[0] for b in batch]
    width = max(len(s) for s in seqs)
    input_ids = torch.full((len(seqs), width), tok.pad_token_id)
    mask = torch.zeros((len(seqs), width), dtype=torch.long)
    for i, s in enumerate(seqs):
        input_ids[i, : len(s)] = torch.tensor(s)
        mask[i, : len(s)] = 1
    labels = torch.tensor([b[1] for b in batch])
    return input_ids, mask, labels


def train(texts, labels, epochs, lr=3e-5, batch_size=32):
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=2).to(DEVICE)
    data = list(zip(encode(texts), labels))
    loader = DataLoader(data, batch_size=batch_size, shuffle=True, collate_fn=collate)
    # class weights for the imbalance that remains after downsampling
    pos = sum(labels) / len(labels)
    weight = torch.tensor([1 / (1 - pos), 1 / pos], device=DEVICE)
    weight = weight / weight.sum() * 2
    loss_fn = torch.nn.CrossEntropyLoss(weight=weight)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    steps = epochs * len(loader)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, s / (0.06 * steps)) * max(0.0, (steps - s) / steps))
    scaler = torch.amp.GradScaler()
    model.train()
    for ep in range(epochs):
        t0, total = time.time(), 0.0
        for input_ids, mask, y in loader:
            input_ids, mask, y = input_ids.to(DEVICE), mask.to(DEVICE), y.to(DEVICE)
            with torch.autocast(DEVICE, dtype=torch.float16):
                loss = loss_fn(model(input_ids=input_ids, attention_mask=mask).logits.float(), y)
            opt.zero_grad()
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item()
        print(f"  epoch {ep + 1}/{epochs} loss={total / len(loader):.4f} ({time.time() - t0:.0f}s)", flush=True)
    model.eval()
    return model


@torch.no_grad()
def predict(model, texts, batch_size=128):
    enc = encode(texts)
    order = np.argsort([len(e) for e in enc])  # length-sorted batches are much faster
    probs = np.zeros(len(enc))
    for i in range(0, len(order), batch_size):
        idx = order[i: i + batch_size]
        input_ids, mask, _ = collate([(enc[j], 0) for j in idx])
        with torch.autocast(DEVICE, dtype=torch.float16):
            logits = model(input_ids=input_ids.to(DEVICE), attention_mask=mask.to(DEVICE)).logits
        probs[idx] = torch.softmax(logits.float(), -1)[:, 1].cpu().numpy()
    return probs


def main():
    t0 = time.time()
    print("device:", DEVICE, torch.cuda.get_device_name(0) if DEVICE == "cuda" else "")
    train_all = load("train")
    test = load("test")
    tr, val = split_train_val(train_all["conversations"])
    val_predators = {p for c in val for p in c["predators"]}

    s1_train = downsample_negatives(tr, ratio=8)
    print(f"stage 1: {len(s1_train):,} conversations")
    stage1 = train([conv_text(c) for c in s1_train], [int(bool(c["predators"])) for c in s1_train], epochs=2)

    x2, y2 = stage2_examples(tr)
    print(f"stage 2: {len(x2):,} author documents")
    stage2 = train(x2, y2, epochs=3)
    train_seconds = round(time.time() - t0)

    def score2(texts):
        return predict(stage2, texts)

    cfg = tune_thresholds(val, val_predators, predict(stage1, [conv_text(c) for c in val]), score2)
    print("tuned:", cfg["t1"], cfg["t2"], "val F0.5 =", cfg["val_author"]["f0.5"])

    print("scoring test set ...", flush=True)
    p1_test = predict(stage1, [conv_text(c) for c in test["conversations"]])
    out = evaluate_and_save("distilbert", test, p1_test, score2, cfg,
                            extra={"train_seconds": train_seconds, "total_seconds": round(time.time() - t0)})

    save = ROOT / "models" / "distilbert"
    for name, m in [("stage1", stage1), ("stage2", stage2)]:
        m.save_pretrained(save / name)
        tok.save_pretrained(save / name)

    f = out["test_final_author_level_PAN12"]
    print(f"TEST author-level: P={f['precision']} R={f['recall']} F1={f['f1']} F0.5={f['f0.5']} acc={f['accuracy']}")


if __name__ == "__main__":
    main()

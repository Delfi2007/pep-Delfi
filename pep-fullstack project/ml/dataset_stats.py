"""Aggregate statistics about PAN12 for the dashboard. Counts only — no chat text is exported.

    ..\\.venv\\Scripts\\python dataset_stats.py
"""
import json

import numpy as np

from common import RESULTS, authors_of, load, split_train_val


def hist(values, edges):
    counts, _ = np.histogram(values, bins=edges)
    labels = [f"{edges[i]}–{edges[i + 1] - 1}" if edges[i + 1] - edges[i] > 1 else str(edges[i])
              for i in range(len(edges) - 2)] + [f"{edges[-2]}+"]
    return [{"bin": l, "count": int(c)} for l, c in zip(labels, counts)]


def describe(name, convs, predators=None):
    pos = [c for c in convs if c["predators"]]
    authors = {a for c in convs for a in authors_of(c)}
    preds = {p for c in convs for p in c["predators"]} if predators is None else predators & authors
    n_msgs = [len(c["messages"]) for c in convs]
    return {
        "split": name,
        "conversations": len(convs),
        "conversations_with_predator": len(pos),
        "positive_rate_pct": round(100 * len(pos) / len(convs), 3),
        "authors": len(authors),
        "predators": len(preds),
        "predator_rate_pct": round(100 * len(preds) / max(1, len(authors)), 3),
        "messages": int(sum(n_msgs)),
        "messages_per_conversation_median": float(np.median(n_msgs)),
        "messages_per_conversation_mean": round(float(np.mean(n_msgs)), 2),
    }


def main():
    train_all, test = load("train"), load("test")
    tr, val = split_train_val(train_all["conversations"])
    splits = [describe("train", tr), describe("validation", val),
              describe("test (official)", test["conversations"], test["predators"])]

    edges = [1, 2, 3, 5, 10, 20, 50, 100, 200, 10_000]
    all_tr = train_all["conversations"]
    pos = [len(c["messages"]) for c in all_tr if c["predators"]]
    neg = [len(c["messages"]) for c in all_tr if not c["predators"]]
    authors_per_conv = [len(authors_of(c)) for c in all_tr]
    pred_convs = {}
    for c in all_tr:
        for p in c["predators"]:
            pred_convs[p] = pred_convs.get(p, 0) + 1

    out = {
        "name": "PAN 2012 Sexual Predator Identification",
        "source": "https://zenodo.org/records/3713280",
        "task_page": "https://pan.webis.de/clef12/pan12-web/sexual-predator-identification.html",
        "notes": [
            "Predator conversations are between convicted offenders and adult volunteer decoys "
            "(Perverted-Justice) posing as minors — no real child is involved.",
            "Negatives include ordinary chats and adult sexual chats (hard negatives).",
            "English only; 2000s-era chat style.",
            "Raw text is kept out of the repository and is never served by the API.",
        ],
        "splits": splits,
        "messages_per_conversation": {
            "with_predator": hist(pos, edges),
            "without_predator": hist(neg, edges),
        },
        "authors_per_conversation": hist(authors_per_conv, [1, 2, 3, 4, 5, 10, 1000]),
        "conversations_per_predator": {
            "mean": round(float(np.mean(list(pred_convs.values()))), 2),
            "median": float(np.median(list(pred_convs.values()))),
            "max": int(max(pred_convs.values())),
        },
    }
    (RESULTS / "dataset_stats.json").write_text(json.dumps(out, indent=2))
    for s in splits:
        print(s)


if __name__ == "__main__":
    main()

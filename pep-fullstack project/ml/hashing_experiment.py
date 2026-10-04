"""How well does each fingerprint survive everyday edits?  (research_papers/ACPIA_14)

Data: 400 procedurally generated, entirely benign images (gradients, shapes, textures, text).
No real or sensitive imagery is used or needed to measure hash robustness.

For each hash (SHA-256, aHash, dHash, pHash) we measure:
  * match rate per transform  — share of edited copies still matched to their original
    at Hamming distance <= T (T = 10 of 64 bits)
  * false-match rate          — share of pairs of *different* images that collide at T
  * ROC-AUC                   — how well distance separates "same image" from "different image"
  * a threshold sweep T = 0..32 for the frontend's ROC-style chart

    ..\\.venv\\Scripts\\python hashing_experiment.py
"""
import json
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from sklearn.metrics import roc_auc_score

from common import RESULTS, ROOT
from phash import (PERCEPTUAL, TRANSFORM_LABELS, TRANSFORMS, fingerprint, hamming, sha256_bytes,
                   to_bytes)

N_IMAGES = 400
SIZE = 256
THRESHOLD = 10
N_IMPOSTOR = 30_000


def synth_image(rng):
    """A random 'scene': smooth background, blurred texture, shapes, lines and a text label."""
    c1, c2 = rng.integers(0, 256, 3), rng.integers(0, 256, 3)
    t = np.linspace(0, 1, SIZE)[:, None, None]
    grad = (c1 * (1 - t) + c2 * t).repeat(SIZE, axis=1)
    if rng.random() < 0.5:
        grad = grad.transpose(1, 0, 2)
    tex = rng.normal(0, 1, (SIZE // 8, SIZE // 8))
    tex = np.kron(tex, np.ones((8, 8)))[..., None] * rng.uniform(10, 35)
    img = Image.fromarray(np.clip(grad + tex, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
    d = ImageDraw.Draw(img)
    for _ in range(rng.integers(4, 12)):
        x0, y0 = rng.integers(0, SIZE, 2)
        x1, y1 = x0 + rng.integers(15, 120), y0 + rng.integers(15, 120)
        col = tuple(int(v) for v in rng.integers(0, 256, 3))
        kind = rng.integers(0, 3)
        if kind == 0:
            d.ellipse([x0, y0, x1, y1], fill=col)
        elif kind == 1:
            d.rectangle([x0, y0, x1, y1], fill=col)
        else:
            pts = [tuple(int(v) for v in rng.integers(0, SIZE, 2)) for _ in range(3)]
            d.polygon(pts, fill=col)
    for _ in range(rng.integers(0, 5)):
        d.line([tuple(int(v) for v in rng.integers(0, SIZE, 2)) for _ in range(2)],
               fill=tuple(int(v) for v in rng.integers(0, 256, 3)), width=int(rng.integers(1, 5)))
    d.text((int(rng.integers(5, 150)), int(rng.integers(5, 230))), f"IMG-{int(rng.integers(1e4)):04d}",
           fill=(255, 255, 255))
    return img


def main():
    t0 = time.time()
    rng = np.random.default_rng(42)
    images = [synth_image(rng) for _ in range(N_IMAGES)]
    originals = [fingerprint(im) for im in images]

    names = ["sha256"] + list(PERCEPTUAL)
    per_transform = {h: {} for h in names}
    genuine = {h: [] for h in PERCEPTUAL}

    for tname, fn in TRANSFORMS.items():
        dists = {h: [] for h in PERCEPTUAL}
        sha_match = 0
        for im, orig in zip(images, originals):
            edited = fn(im).convert("RGB")
            fp = fingerprint(edited, to_bytes(edited))
            sha_match += fp["sha256"] == orig["sha256"]
            for h in PERCEPTUAL:
                dists[h].append(hamming(fp[h], orig[h]))
        per_transform["sha256"][tname] = {"match_rate": round(sha_match / N_IMAGES, 4), "mean_distance": None}
        for h in PERCEPTUAL:
            arr = np.array(dists[h])
            genuine[h].extend(arr.tolist())
            per_transform[h][tname] = {"match_rate": round(float((arr <= THRESHOLD).mean()), 4),
                                       "mean_distance": round(float(arr.mean()), 2)}

    # an unchanged copy, byte-for-byte: the only case SHA-256 is built for
    for h in names:
        per_transform[h]["exact_copy"] = {"match_rate": 1.0, "mean_distance": 0.0 if h != "sha256" else None}

    # impostor pairs: two different originals
    i = rng.integers(0, N_IMAGES, N_IMPOSTOR)
    j = rng.integers(0, N_IMAGES, N_IMPOSTOR)
    keep = i != j
    i, j = i[keep], j[keep]
    impostor = {h: np.array([hamming(originals[a][h], originals[b][h]) for a, b in zip(i, j)]) for h in PERCEPTUAL}
    sha_collisions = int(sum(originals[a]["sha256"] == originals[b]["sha256"] for a, b in zip(i, j)))

    summary = {"sha256": {"overall_match_rate": round(float(np.mean(
        [v["match_rate"] for k, v in per_transform["sha256"].items() if k != "exact_copy"])), 4),
        "false_match_rate": round(sha_collisions / len(i), 6), "roc_auc": None}}
    sweep = {}
    for h in PERCEPTUAL:
        g, imp = np.array(genuine[h]), impostor[h]
        y = np.r_[np.ones(len(g)), np.zeros(len(imp))]
        auc = roc_auc_score(y, -np.r_[g, imp])            # smaller distance = more likely the same image
        summary[h] = {"overall_match_rate": round(float((g <= THRESHOLD).mean()), 4),
                      "false_match_rate": round(float((imp <= THRESHOLD).mean()), 6),
                      "roc_auc": round(float(auc), 4),
                      "mean_genuine_distance": round(float(g.mean()), 2),
                      "mean_impostor_distance": round(float(imp.mean()), 2)}
        sweep[h] = [{"threshold": T, "match_rate": round(float((g <= T).mean()), 4),
                     "false_match_rate": round(float((imp <= T).mean()), 6)} for T in range(0, 33)]

    out = {
        "description": "Robustness of image fingerprints to everyday edits, on 400 procedurally generated benign images.",
        "n_images": N_IMAGES, "image_size": SIZE, "bits": 64, "threshold": THRESHOLD,
        "n_impostor_pairs": int(len(i)),
        "hashes": {"sha256": "SHA-256 (cryptographic, exact bytes)", "ahash": "Average hash (aHash)",
                   "dhash": "Difference hash (dHash)", "phash": "DCT perceptual hash (pHash)"},
        "transforms": {**TRANSFORM_LABELS, "exact_copy": "Unchanged byte-for-byte copy"},
        "per_transform": per_transform,
        "summary": summary,
        "sweep": sweep,
        "seconds": round(time.time() - t0, 1),
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "hashing.json").write_text(json.dumps(out, indent=2))

    # keep a handful of sample images so the UI can show what the test data looks like
    sample_dir = ROOT / "data" / "synthetic" / "hash_samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    for k, im in enumerate(images[:6]):
        im.save(sample_dir / f"sample_{k}.png")

    for h in names:
        print(f"{h:7s}", summary[h])
    print("saved", RESULTS / "hashing.json", f"({out['seconds']}s)")


if __name__ == "__main__":
    main()

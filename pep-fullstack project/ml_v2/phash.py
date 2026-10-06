"""Image fingerprints used for known-material matching.

SHA-256 matches only byte-identical files. Perceptual hashes (aHash, dHash, pHash)
summarise what an image *looks like*, so a re-compressed, resized or lightly edited copy
still lands within a small Hamming distance of the original. This is the idea behind
ACPIA's hash gate and research_papers/ACPIA_14 (ChaSAM perceptual hashing).

All three perceptual hashes are 64-bit and implemented here with Pillow + NumPy + SciPy.
"""
import hashlib
import io

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageOps
from scipy.fft import dctn

BITS = 64


def _gray(img, size):
    return np.asarray(img.convert("L").resize(size, Image.LANCZOS), dtype=np.float32)


def ahash(img):
    px = _gray(img, (8, 8))
    return (px > px.mean()).flatten()


def dhash(img):
    px = _gray(img, (9, 8))
    return (px[:, 1:] > px[:, :-1]).flatten()


def phash(img):
    px = _gray(img, (32, 32))
    low = dctn(px, norm="ortho")[:8, :8].flatten()
    return low > np.median(low[1:])          # ignore the DC term when choosing the cut


PERCEPTUAL = {"ahash": ahash, "dhash": dhash, "phash": phash}


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def to_bytes(img, fmt="PNG", **kw):
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kw)
    return buf.getvalue()


def hamming(a, b):
    return int(np.count_nonzero(a != b))


def bits_to_hex(bits):
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


# ------------------------------------------------------------------ transforms
def _jpeg(img, q):
    return Image.open(io.BytesIO(to_bytes(img.convert("RGB"), "JPEG", quality=q))).convert("RGB")


def _resize(img, f):
    w, h = img.size
    return img.resize((max(8, int(w * f)), max(8, int(h * f))), Image.BILINEAR)


def _crop(img, frac):
    w, h = img.size
    dx, dy = int(w * frac), int(h * frac)
    return img.crop((dx, dy, w - dx, h - dy))


def _noise(img, sigma):
    a = np.asarray(img, dtype=np.float32)
    a = a + np.random.default_rng(0).normal(0, sigma, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def _watermark(img):
    img = img.copy()
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rectangle([w * 0.05, h * 0.82, w * 0.6, h * 0.95], fill=(255, 255, 255))
    d.text((w * 0.07, h * 0.84), "shared via app", fill=(0, 0, 0))
    return img


def _border(img):
    return ImageOps.expand(img, border=int(img.size[0] * 0.08), fill=(0, 0, 0))


TRANSFORMS = {
    "jpeg_q90": lambda im: _jpeg(im, 90),
    "jpeg_q50": lambda im: _jpeg(im, 50),
    "jpeg_q20": lambda im: _jpeg(im, 20),
    "resize_50": lambda im: _resize(im, 0.5),
    "resize_25": lambda im: _resize(im, 0.25),
    "crop_5": lambda im: _crop(im, 0.05),
    "crop_15": lambda im: _crop(im, 0.15),
    "rotate_3": lambda im: im.rotate(3, resample=Image.BILINEAR, fillcolor=(0, 0, 0)),
    "brightness_+30": lambda im: ImageEnhance.Brightness(im).enhance(1.3),
    "contrast_+40": lambda im: ImageEnhance.Contrast(im).enhance(1.4),
    "blur_r2": lambda im: im.filter(ImageFilter.GaussianBlur(2)),
    "noise_s10": lambda im: _noise(im, 10),
    "grayscale": lambda im: ImageOps.grayscale(im).convert("RGB"),
    "watermark": _watermark,
    "border_8pct": _border,
    "flip_h": ImageOps.mirror,
}

TRANSFORM_LABELS = {
    "jpeg_q90": "JPEG re-save, quality 90", "jpeg_q50": "JPEG re-save, quality 50",
    "jpeg_q20": "JPEG re-save, quality 20", "resize_50": "Resized to 50%", "resize_25": "Resized to 25%",
    "crop_5": "Cropped 5% each side", "crop_15": "Cropped 15% each side", "rotate_3": "Rotated 3°",
    "brightness_+30": "Brightness +30%", "contrast_+40": "Contrast +40%", "blur_r2": "Gaussian blur r=2",
    "noise_s10": "Gaussian noise σ=10", "grayscale": "Converted to greyscale",
    "watermark": "Caption / watermark overlay", "border_8pct": "Black border (screenshot-style)",
    "flip_h": "Mirrored horizontally",
}


def fingerprint(img, raw_bytes=None):
    img = img.convert("RGB")
    data = raw_bytes if raw_bytes is not None else to_bytes(img)
    out = {"sha256": sha256_bytes(data)}
    for name, fn in PERCEPTUAL.items():
        out[name] = fn(img)
    return out

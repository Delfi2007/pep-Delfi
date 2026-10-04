"""Machine-learning layer for ACPIA.

Serves the models trained in ../ml (PAN 2012 Sexual Predator Identification
benchmark) and runs them over a case's own conversations.

Every model uses the same two-stage pipeline it was trained with
(ml/common.py):

  stage 1  conversation — does this thread look like grooming?
  stage 2  participant  — inside a thread, who is driving it?

A participant is flagged when stage 1 >= t1 AND their stage 2 >= t2. Two
threshold modes are returned side by side, because they answer different
questions:

  tuned   the frozen PAN12-optimal thresholds (very strict — tuned for
          precision across 218k users, where a false accusation is the
          costly error)
  triage  t1 = t2 = 0.5 — a looser setting for surfacing threads for review

Like the rest of ACPIA, this layer proposes and never decides: nothing here
writes to the case, and an ML score is never a finding until an officer
rules on it.

Mounted on the main app with `app.include_router(ml_service.router)`.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException

from identity import resolve_identities
from store import get_store, has_store

ROOT = Path(__file__).resolve().parent.parent
ML_DIR = ROOT / "ml"
MODELS_DIR = ROOT / "models"
RESULTS_DIR = ROOT / "results"
GOV_STATS = ROOT / "data" / "gov" / "gov_stats.json"

# The behavioural model's pickle references ml/ml_signals.py. Appended, not
# inserted, so backend modules (signals.py, report.py, ...) always win a
# name lookup over anything in ml/.
if str(ML_DIR) not in sys.path:
    sys.path.append(str(ML_DIR))

from ml_signals import FEATURE_NAMES, features, signal_hits  # noqa: E402

CLASSICAL = ["tfidf_lr", "tfidf_svm", "tfidf_cnb", "char_lr", "behavioral_hgb", "tfidf_cnb_aug", "tfidf_lr_aug"]
ORDER = ["distilbert", "ensemble", *CLASSICAL]
DEFAULT_MODEL = "char_lr"   # transfers best to modern-style chats (results/synthetic_eval.json)

router = APIRouter()


# --------------------------------------------------------------------------- registry

class _Registry:
    def __init__(self) -> None:
        self.bundles: dict[str, dict] = {}
        self._bert: dict[str, Any] | None = None
        self._lock = threading.Lock()
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            for name in CLASSICAL:
                path = MODELS_DIR / f"{name}.joblib"
                if path.exists():
                    self.bundles[name] = joblib.load(path)
            self._loaded = True

    @staticmethod
    def results(name: str) -> dict | None:
        path = RESULTS_DIR / f"{name}.json"
        return json.loads(path.read_text()) if path.exists() else None

    def live(self) -> list[str]:
        self.load()
        bert = (MODELS_DIR / "distilbert" / "stage1").exists()
        out = []
        for n in ORDER:
            if n in self.bundles or (n == "distilbert" and bert) or (n == "ensemble" and bert and "tfidf_lr" in self.bundles):
                out.append(n)
        return out

    # DistilBERT is loaded lazily: it is the one model that needs torch, and
    # the console should start fast even on a machine without a GPU.
    def _distilbert(self) -> dict[str, Any]:
        with self._lock:
            if self._bert is None:
                import torch
                from transformers import AutoModelForSequenceClassification, AutoTokenizer

                device = "cuda" if torch.cuda.is_available() else "cpu"
                d = MODELS_DIR / "distilbert"
                t = (self.results("distilbert") or {}).get("thresholds", {})
                self._bert = {
                    "tok": AutoTokenizer.from_pretrained(d / "stage1"),
                    "s1": AutoModelForSequenceClassification.from_pretrained(d / "stage1").to(device).eval(),
                    "s2": AutoModelForSequenceClassification.from_pretrained(d / "stage2").to(device).eval(),
                    "device": device,
                    "t1": t.get("t1_stage1", 0.998),
                    "t2": t.get("t2_stage2", 0.98),
                }
            return self._bert

    def _bert_predict(self, model: Any, texts: list[str], batch: int = 64) -> np.ndarray:
        import torch

        b = self._distilbert()
        tok, head, max_len = b["tok"], 128, 256
        out = np.zeros(len(texts))
        for start in range(0, len(texts), batch):
            chunk = texts[start:start + batch]
            ids = tok(chunk, add_special_tokens=False, truncation=False)["input_ids"]
            seqs = []
            for x in ids:
                if len(x) > max_len - 2:
                    x = x[:head] + x[-(max_len - 2 - head):]
                seqs.append([tok.cls_token_id] + x + [tok.sep_token_id])
            width = max(len(s) for s in seqs)
            inp = torch.full((len(seqs), width), tok.pad_token_id)
            mask = torch.zeros((len(seqs), width), dtype=torch.long)
            for i, s in enumerate(seqs):
                inp[i, : len(s)] = torch.tensor(s)
                mask[i, : len(s)] = 1
            with torch.no_grad():
                logits = model(input_ids=inp.to(b["device"]), attention_mask=mask.to(b["device"])).logits
            out[start:start + len(chunk)] = torch.softmax(logits.float(), -1)[:, 1].cpu().numpy()
        return out

    def scorers(self, name: str):
        """(stage1_fn, stage2_fn, t1, t2) for a model id."""
        self.load()
        if name == "distilbert":
            b = self._distilbert()
            return (lambda x: self._bert_predict(b["s1"], x), lambda x: self._bert_predict(b["s2"], x), b["t1"], b["t2"])
        if name == "ensemble":
            b, lr = self._distilbert(), self.bundles["tfidf_lr"]
            t = (self.results("ensemble") or {}).get("thresholds", {})
            return (
                lambda x: (self._bert_predict(b["s1"], x) + lr["stage1"].predict_proba(x)[:, 1]) / 2,
                lambda x: (self._bert_predict(b["s2"], x) + lr["stage2"].predict_proba(x)[:, 1]) / 2,
                t.get("t1_stage1", 0.5),
                t.get("t2_stage2", 0.5),
            )
        b = self.bundles[name]
        return (lambda x: b["stage1"].predict_proba(x)[:, 1], lambda x: b["stage2"].predict_proba(x)[:, 1], b["t1"], b["t2"])

    def top_terms(self, name: str, stage: str, text: str, k: int = 6) -> list[dict]:
        """What pushed the score up. Linear models: n-gram contributions;
        the gradient-boosting model: the behaviour signals that fired.
        Transformers have no cheap faithful attribution, so they return none
        rather than a decorative one."""
        if name == "behavioral_hgb":
            vals = dict(zip(FEATURE_NAMES, features(text)))
            lex = [(n, v) for n, v in vals.items() if n.startswith("lex_") and not n.endswith("_any") and v > 0]
            lex.sort(key=lambda t: -t[1])
            return [{"term": n.replace("lex_", "").replace("_", " "), "weight": round(float(v), 3)} for n, v in lex[:k]]
        if name not in self.bundles:
            return []
        pipe = self.bundles[name][stage]
        vec, clf = pipe.steps[0][1], pipe.steps[-1][1]
        if hasattr(clf, "coef_"):
            w = clf.coef_[0]
        elif hasattr(clf, "calibrated_classifiers_"):
            w = np.mean([c.estimator.coef_[0] for c in clf.calibrated_classifiers_], axis=0)
        elif hasattr(clf, "feature_log_prob_"):
            w = clf.feature_log_prob_[1] - clf.feature_log_prob_[0]
        else:
            return []
        x = vec.transform([text])
        contrib = x.data * w[x.indices]
        names = vec.get_feature_names_out()
        # Character n-grams like " call" and "call " are distinct features but
        # read identically once trimmed — keep the strongest of each.
        out: dict[str, float] = {}
        for i in np.argsort(-contrib):
            if contrib[i] <= 0 or len(out) >= k:
                break
            term = str(names[x.indices[i]]).strip()
            if term and term not in out:
                out[term] = round(float(contrib[i]), 4)
        return [{"term": t, "weight": v} for t, v in out.items()]


registry = _Registry()


# --------------------------------------------------------------------------- case threads

def _case_threads(case_id: str) -> tuple[list[dict], dict[str, str]]:
    """Group a case's messages into threads between resolved actors.

    A thread is the set of actors on a message, after identity resolution —
    so the same person on WhatsApp and Instagram is one participant, exactly
    as the rest of ACPIA sees them. Returns (threads, actor_id -> label)."""
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    to_actor: dict[str, str] = {}
    labels: dict[str, str] = {}
    for actor in identities:
        labels[actor.actor_id] = actor.label
        for ident in actor.identifiers:
            to_actor[ident] = actor.actor_id

    threads: dict[frozenset, dict] = {}
    for a in sorted((x for x in store.artifacts if x.type == "message"), key=lambda x: x.time.value):
        content = store.content.get(a.content_ref) or {}
        text = (content.get("text") or "").strip()
        if not text:
            continue
        sender = content.get("sender") or (a.actors[0] if a.actors else "unknown")
        author = to_actor.get(sender, sender)
        labels.setdefault(author, content.get("sender_display") or sender)
        members = frozenset({to_actor.get(x, x) for x in a.actors} | {author})
        for m in members:
            labels.setdefault(m, m)
        t = threads.setdefault(members, {"messages": [], "artifact_ids": [], "sources": set(),
                                         "first": a.time.value, "last": a.time.value})
        t["messages"].append((author, text))
        t["artifact_ids"].append(a.artifact_id)
        t["sources"].add(a.source)
        t["last"] = a.time.value

    out = []
    for i, (members, t) in enumerate(sorted(threads.items(), key=lambda kv: -len(kv[1]["messages"]))):
        out.append({"thread_id": f"t_{i + 1:03d}", "members": sorted(members), **t, "sources": sorted(t["sources"])})
    return out, labels


_cache: dict[tuple[str, str, int], dict] = {}


def analyse_case(case_id: str, model: str) -> dict:
    store = get_store(case_id)
    key = (case_id, model, store.count)
    if key in _cache:
        return _cache[key]

    threads, labels = _case_threads(case_id)
    s1, s2, t1, t2 = registry.scorers(model)
    started = time.perf_counter()

    conv_texts = ["\n".join(txt for _, txt in t["messages"]) for t in threads]
    p1 = s1(conv_texts) if threads else []

    pairs = [(ti, a) for ti, t in enumerate(threads) for a in sorted({x for x, _ in t["messages"]})]
    author_texts = ["\n".join(txt for x, txt in threads[ti]["messages"] if x == a) for ti, a in pairs]
    p2 = s2(author_texts) if pairs else []
    elapsed_ms = (time.perf_counter() - started) * 1000

    per_thread: dict[int, list[dict]] = defaultdict(list)
    for (ti, a), score, txt in zip(pairs, p2, author_texts):
        per_thread[ti].append({
            "actor_id": a, "label": labels.get(a, a), "score": round(float(score), 4),
            "messages": sum(1 for x, _ in threads[ti]["messages"] if x == a),
            "signals": signal_hits(txt),
        })

    out_threads = []
    actor_best: dict[str, dict] = {}
    for ti, t in enumerate(threads):
        conv_score = float(p1[ti])
        authors = sorted(per_thread[ti], key=lambda x: -x["score"])
        for au in authors:
            au["flag_tuned"] = conv_score >= t1 and au["score"] >= t2
            au["flag_triage"] = conv_score >= 0.5 and au["score"] >= 0.5
            best = actor_best.setdefault(au["actor_id"], {
                "actor_id": au["actor_id"], "label": au["label"], "max_participant_score": 0.0,
                "max_thread_score": 0.0, "threads": 0, "ranked_instigator_in": 0,
                "flag_tuned": False, "flag_triage": False})
            best["threads"] += 1
            best["max_participant_score"] = max(best["max_participant_score"], au["score"])
            best["max_thread_score"] = max(best["max_thread_score"], conv_score)
            best["flag_tuned"] |= au["flag_tuned"]
            best["flag_triage"] |= au["flag_triage"]
        if len(authors) > 1:
            actor_best[authors[0]["actor_id"]]["ranked_instigator_in"] += 1
        out_threads.append({
            "thread_id": t["thread_id"],
            "participants": [labels.get(m, m) for m in t["members"]],
            "message_count": len(t["messages"]),
            "sources": t["sources"],
            "first": t["first"],
            "last": t["last"],
            "score": round(conv_score, 4),
            "flag_tuned": conv_score >= t1,
            "flag_triage": conv_score >= 0.5,
            "authors": authors,
            "ranked_instigator": authors[0]["label"] if len(authors) > 1 else None,
            "top_terms": registry.top_terms(model, "stage1", conv_texts[ti]),
            "signals": signal_hits(conv_texts[ti]),
            "artifact_ids": t["artifact_ids"],
        })
    out_threads.sort(key=lambda x: -x["score"])

    result = {
        "model": model,
        "label": (registry.results(model) or {}).get("label", model),
        "thresholds": {"t1": t1, "t2": t2},
        "thread_count": len(threads),
        "message_count": sum(t["message_count"] for t in out_threads),
        "latency_ms": round(elapsed_ms, 1),
        "threads": out_threads,
        "actors": sorted(actor_best.values(), key=lambda a: -a["max_participant_score"]),
    }
    _cache[key] = result
    return result


# --------------------------------------------------------------------------- routes

_SUMMARY_KEYS = ["accuracy", "precision", "recall", "f1", "f0.5", "roc_auc", "pr_auc"]


def _summary(name: str, live: bool) -> dict:
    r = registry.results(name) or {}
    f = r["test_final_author_level_PAN12"]
    cal = r.get("calibration", {})
    return {
        "id": name,
        "label": r.get("label", name),
        "family": r.get("family", ""),
        "live": live,
        "thresholds": r["thresholds"],
        "author": {k: f.get(k) for k in _SUMMARY_KEYS} | {"confusion_matrix": f["confusion_matrix"]},
        "stage1": {k: r["test_stage1_conversation"].get(k) for k in _SUMMARY_KEYS},
        "stage2": {k: r["test_stage2_predator_vs_victim"].get(k) for k in _SUMMARY_KEYS},
        "ece_stage1": cal.get("stage1", {}).get("ece"),
        "ece_stage2": cal.get("stage2", {}).get("ece"),
        "train_seconds": r.get("train_seconds"),
        "ms_per_conversation": r.get("stage1_ms_per_conversation"),
        "model_size_mb": r.get("model_size_mb"),
    }


def _read(path: Path) -> Any:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{path.name} has not been generated — run the ml/ scripts")
    return json.loads(path.read_text())


@router.get("/ml/models")
def ml_models() -> list[dict]:
    live = set(registry.live())
    return [_summary(n, n in live) for n in ORDER if (RESULTS_DIR / f"{n}.json").exists()]


@router.get("/ml/models/{name}")
def ml_model_detail(name: str) -> dict:
    if name not in ORDER:
        raise HTTPException(status_code=404, detail="Unknown model")
    return _read(RESULTS_DIR / f"{name}.json")


@router.get("/ml/datasets")
def ml_datasets() -> dict:
    return {
        "pan12": _read(RESULTS_DIR / "dataset_stats.json"),
        "synthetic_eval": _read(RESULTS_DIR / "synthetic_eval.json"),
    }


@router.get("/ml/gov")
def ml_gov() -> dict:
    return _read(GOV_STATS)


@router.get("/ml/hashing")
def ml_hashing() -> dict:
    return _read(RESULTS_DIR / "hashing.json")


def _require_case_store(case_id: str) -> None:
    if not has_store(case_id):
        raise HTTPException(status_code=404, detail="Case not found")


@router.get("/cases/{case_id}/ml")
def case_ml(case_id: str, model: str = DEFAULT_MODEL) -> dict:
    _require_case_store(case_id)
    if model not in registry.live():
        raise HTTPException(status_code=400, detail=f"model must be one of {registry.live()}")
    return analyse_case(case_id, model)


MANIFEST = ROOT / "data" / "case_manifest.json"


def _ground_truth_offender(case_id: str) -> str | None:
    """The synthetic demo bundle ships with its answer key (data/case_manifest.json).
    When this case contains that bundle's offender, return their resolved label so
    each model can be scored against the truth. Any other case gets None — there
    is no ground truth for real evidence, and none is invented."""
    if not MANIFEST.exists():
        return None
    p = json.loads(MANIFEST.read_text()).get("predator", {})
    ids = {p.get("phone"), p.get("ig_handle")} - {None}
    for actor in resolve_identities(get_store(case_id).artifacts):
        if ids & set(actor.identifiers):
            return actor.label
    return None


@router.get("/cases/{case_id}/ml/compare")
def case_ml_compare(case_id: str) -> dict:
    """Every live model over the same case — do they agree on who is driving
    each thread, and (for the demo bundle) are they right?"""
    _require_case_store(case_id)
    truth = _ground_truth_offender(case_id)
    rows = []
    for name in registry.live():
        r = analyse_case(case_id, name)
        top = r["actors"][0] if r["actors"] else None
        flagged_tuned = [a["label"] for a in r["actors"] if a["flag_tuned"]]
        flagged_triage = [a["label"] for a in r["actors"] if a["flag_triage"]]
        row = {
            "model": name,
            "label": r["label"],
            "latency_ms": r["latency_ms"],
            "threads_over_triage": sum(1 for t in r["threads"] if t["flag_triage"]),
            "threads_over_tuned": sum(1 for t in r["threads"] if t["flag_tuned"]),
            "top_actor": top["label"] if top else None,
            "top_actor_score": top["max_participant_score"] if top else None,
            "actors_flagged_tuned": flagged_tuned,
            "actors_flagged_triage": flagged_triage,
        }
        if truth:
            ranking = [a["label"] for a in r["actors"]]
            row["truth"] = {
                "offender_rank": ranking.index(truth) + 1 if truth in ranking else None,
                "caught_tuned": truth in flagged_tuned,
                "caught_triage": truth in flagged_triage,
                "false_flags_tuned": [x for x in flagged_tuned if x != truth],
                "false_flags_triage": [x for x in flagged_triage if x != truth],
            }
        rows.append(row)
    return {"ground_truth_offender": truth, "models": rows}

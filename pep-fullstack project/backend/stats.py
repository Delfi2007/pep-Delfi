"""Cross-case aggregates for the dashboard.

Every number here is computed from artifacts actually in the store. There
are deliberately no trend deltas ("+12% from last month", "+53 this
week") — nothing in ACPIA records history, so a delta would be invented,
and a fabricated figure on a dashboard is the same failure mode the
citation guard exists to prevent. If a trend is wanted later, it needs a
real ingest-time audit log to compute from.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import signals
from identity import resolve_identities
from models import Artifact, Case
from store import CaseStore, get_store, has_store

TYPE_LABELS = {
    "message": "Messages",
    "call": "Calls",
    "image": "Images",
    "browser_history": "Browser history",
}

RECENT_ACTIVITY_LIMIT = 8
FLAGGED_LIMIT = 10


def _preview(artifact: Artifact, store: CaseStore) -> str:
    """Mirrors the frontend's previewFor so an artifact reads the same
    wherever it surfaces."""
    c = store.content.get(artifact.content_ref) or {}
    if artifact.type == "message":
        return str(c.get("text", ""))
    if artifact.type == "call":
        seconds = int(c.get("duration_seconds", 0) or 0)
        return f"Call · {seconds // 60}m {seconds % 60}s · {c.get('from')} → {c.get('to')}"
    if artifact.type == "browser_history":
        return str(c.get("title") or c.get("url") or "")
    if artifact.type == "image":
        return str(c.get("filename", ""))
    return ""


def _flag_reason(flag: str) -> str:
    """Turn the machine flag into something an officer can read without
    overclaiming. A hash match says 'these bytes are on the known list',
    not 'this depicts X' — we never classify imagery."""
    if flag.startswith("hash_match"):
        algorithm = flag.split(":", 1)[1] if ":" in flag else "hash"
        return f"Known-hash match ({algorithm.upper()})"
    return flag


def build_stats(cases: list[Case]) -> dict[str, Any]:
    by_status = Counter(c.status for c in cases)
    type_counts: Counter[str] = Counter()
    activity: list[dict[str, Any]] = []
    flagged: list[dict[str, Any]] = []

    total_artifacts = 0
    total_flagged = 0

    for case in cases:
        if not has_store(case.case_id):
            continue
        store = get_store(case.case_id)
        total_artifacts += store.count
        total_flagged += store.flagged_count

        for artifact in store.artifacts:
            type_counts[artifact.type] += 1

        for artifact in sorted(
            store.artifacts, key=lambda a: a.time.value, reverse=True
        )[:RECENT_ACTIVITY_LIMIT]:
            activity.append(
                {
                    "artifact_id": artifact.artifact_id,
                    "case_id": case.case_id,
                    "case_title": case.title,
                    "type": artifact.type,
                    "source": artifact.source,
                    "time": artifact.time.value,
                    "tz_inferred": artifact.time.tz_inferred,
                    "preview": _preview(artifact, store),
                    "flagged": bool(artifact.flags),
                }
            )

        for artifact in store.artifacts:
            if not artifact.flags:
                continue
            flagged.append(
                {
                    "artifact_id": artifact.artifact_id,
                    "case_id": case.case_id,
                    "case_title": case.title,
                    "item": _preview(artifact, store) or artifact.source,
                    "type": artifact.type,
                    "reason": _flag_reason(artifact.flags[0]),
                    "time": artifact.time.value,
                }
            )

    activity.sort(key=lambda a: a["time"], reverse=True)
    flagged.sort(key=lambda f: f["time"], reverse=True)

    return {
        "totals": {
            "cases": len(cases),
            "open": by_status.get("open", 0),
            "under_review": by_status.get("under_review", 0),
            "closed": by_status.get("closed", 0),
            "artifacts": total_artifacts,
            "flagged": total_flagged,
        },
        "evidence_by_type": [
            {"type": t, "label": TYPE_LABELS.get(t, t), "count": n}
            for t, n in type_counts.most_common()
        ],
        "recent_activity": activity[:RECENT_ACTIVITY_LIMIT],
        "flagged_items": flagged[:FLAGGED_LIMIT],
        "insight": _build_insight(cases),
    }


def _build_insight(cases: list[Case]) -> dict[str, Any] | None:
    """One headline drawn from the signal layer for the most recent case
    that actually has evidence. Cited, like everything else — the
    dashboard shouldn't be the one place claims arrive uncited."""
    candidates = [
        c
        for c in sorted(cases, key=lambda c: c.created_at, reverse=True)
        if has_store(c.case_id) and get_store(c.case_id).count > 0
    ]
    if not candidates:
        return None

    case = candidates[0]
    store = get_store(case.case_id)
    identities = resolve_identities(store.artifacts)
    profiles = signals.build_profiles(store.artifacts, store.content, identities)
    if not profiles:
        return None

    top = max(profiles, key=lambda p: p.risk_score)
    if top.risk_score <= 0:
        return None

    # Cite the artifacts the signals were actually computed from, spread
    # across signal kinds rather than all drawn from one.
    evidence: list[str] = []
    for ids in top.signal_evidence.values():
        for artifact_id in ids:
            if artifact_id not in evidence:
                evidence.append(artifact_id)
            if len(evidence) >= 6:
                break
        if len(evidence) >= 6:
            break

    signal_summary = ", ".join(
        f"{count} {kind.replace('_', ' ')}"
        for kind, count in sorted(top.signal_counts.items(), key=lambda kv: -kv[1])
        if count
    )

    return {
        "case_id": case.case_id,
        "case_title": case.title,
        "actor": top.label,
        "risk_score": round(top.risk_score, 3),
        "channels": top.channels,
        "counterparties": len(top.counterparties),
        "late_night_ratio": round(top.late_night_ratio, 3),
        "signal_summary": signal_summary,
        "headline": (
            f"{top.label} spans {len(top.channels)} evidence source"
            f"{'' if len(top.channels) == 1 else 's'} and "
            f"{len(top.counterparties)} counterpart"
            f"{'y' if len(top.counterparties) == 1 else 'ies'}."
        ),
        "evidence": evidence,
    }

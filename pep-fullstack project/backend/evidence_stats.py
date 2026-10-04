"""Evidence statistics and smart search suggestions for the search view.

Precomputes the aggregate data the evidence search page needs without
the frontend making 5 separate requests: type breakdown, platform
distribution, timeline density, top flagged items, and smart search
suggestions based on the grooming-signal lexicons.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime
from typing import Any

from models import Artifact, ResolvedActor
from signals import SIGNAL_LEXICONS, _normalize, CONCERN_THRESHOLD, LATE_NIGHT_HOURS

SMART_SEARCHES: list[dict[str, Any]] = [
    {
        "id": "age_probes",
        "label": "Age probes",
        "icon": "search",
        "query": "age grade old",
        "patterns": SIGNAL_LEXICONS.get("age_probe", []),
    },
    {
        "id": "isolation",
        "label": "Isolation / secrecy",
        "icon": "lock",
        "query": "secret between us",
        "patterns": SIGNAL_LEXICONS.get("isolation", []),
    },
    {
        "id": "channel_migration",
        "label": "Channel migration",
        "icon": "arrow-right",
        "query": "whatsapp number private",
        "patterns": SIGNAL_LEXICONS.get("channel_migration", []),
    },
    {
        "id": "meet_in_person",
        "label": "Meet in person",
        "icon": "map-pin",
        "query": "meet person place",
        "patterns": [
            r"(?:can |should |let.?s )(?:we )?meet",
            r"come (?:over|to)",
            r"pick you up",
            r"where do you (?:stay|live)",
            r"in person",
            r"hang out",
            r"coffee",
            r"(?:my|your) place",
        ],
    },
    {
        "id": "gifts",
        "label": "Gifts & favours",
        "icon": "gift",
        "query": "gift buy present",
        "patterns": [
            r"(?:buy|bought|get|got) you",
            r"surprise for you",
            r"(?:your|a) (?:new |)(?:phone|laptop|gift|present)",
            r"send you (?:money|cash)",
            r"anything you (?:want|need)",
            r"treat you",
        ],
    },
    {
        "id": "flagged_media",
        "label": "Flagged media",
        "icon": "flag",
        "query": "",
        "patterns": [],
    },
]

_COMPILED_SMART: dict[str, list[re.Pattern[str]]] = {}
for s in SMART_SEARCHES:
    if s["patterns"]:
        _COMPILED_SMART[s["id"]] = [re.compile(p) for p in s["patterns"]]


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _channel_label(source: str) -> str:
    s = source.lower()
    if "whatsapp" in s:
        return "WhatsApp"
    if "instagram" in s:
        return "Instagram"
    if "call" in s:
        return "Calls"
    return "Others"


TYPE_META: dict[str, dict[str, str]] = {
    "message": {"label": "Messages", "color": "#34C759"},
    "image": {"label": "Media", "color": "#FF9500"},
    "call": {"label": "Calls", "color": "#FF3B30"},
    "browser_history": {"label": "System events", "color": "#AF52DE"},
}


def build_evidence_stats(
    artifacts: list[Artifact],
    content: dict[str, Any],
    identities: list[ResolvedActor],
    profiles: list | None = None,
) -> dict[str, Any]:

    # Type breakdown
    type_counts: dict[str, int] = defaultdict(int)
    type_flagged: dict[str, int] = defaultdict(int)
    for a in artifacts:
        type_counts[a.type] += 1
        if a.flags:
            type_flagged[a.type] += 1

    total = len(artifacts)
    evidence_by_type = []
    for t in ["message", "image", "call", "browser_history"]:
        c = type_counts.get(t, 0)
        meta = TYPE_META.get(t, {"label": t, "color": "#8E8E93"})
        evidence_by_type.append({
            "type": t,
            "label": meta["label"],
            "count": c,
            "pct": round(c / total * 100, 1) if total else 0,
            "flagged": type_flagged.get(t, 0),
            "color": meta["color"],
        })

    # Platform distribution
    platform_counts: dict[str, int] = defaultdict(int)
    for a in artifacts:
        platform_counts[_channel_label(a.source)] += 1

    platforms = []
    for label in ["WhatsApp", "Instagram", "Calls", "Others"]:
        c = platform_counts.get(label, 0)
        platforms.append({
            "label": label,
            "count": c,
            "pct": round(c / total * 100, 1) if total else 0,
        })

    # Smart search suggestion counts
    suggestions = []
    for search in SMART_SEARCHES:
        if search["id"] == "flagged_media":
            count = sum(1 for a in artifacts if a.flags and a.type == "image")
        else:
            compiled = _COMPILED_SMART.get(search["id"], [])
            count = 0
            for a in artifacts:
                if a.type != "message":
                    continue
                payload = content.get(a.content_ref) or {}
                text = _normalize(payload.get("text", ""))
                for p in compiled:
                    if p.search(text):
                        count += 1
                        break
        suggestions.append({
            "id": search["id"],
            "label": search["label"],
            "icon": search["icon"],
            "query": search["query"],
            "count": count,
        })

    # Timeline density (artifacts per day)
    day_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for a in artifacts:
        try:
            dt = _parse_time(a.time.value)
            day = dt.strftime("%Y-%m-%d")
            day_counts[day][a.type] += 1
            if a.flags:
                day_counts[day]["flagged"] += 1
        except ValueError:
            continue

    timeline = []
    for day in sorted(day_counts.keys()):
        entry = {"date": day, **day_counts[day]}
        timeline.append(entry)

    # Top evidence by risk (flagged artifacts with risk context)
    top_evidence = []
    for a in sorted(artifacts, key=lambda x: (len(x.flags), x.time.value), reverse=True)[:10]:
        if not a.flags:
            continue
        risk = "High" if len(a.flags) >= 2 else "Medium"
        meta = TYPE_META.get(a.type, {"label": a.type, "color": "#8E8E93"})
        top_evidence.append({
            "artifact_id": a.artifact_id,
            "type": a.type,
            "type_label": meta["label"],
            "source": a.source,
            "risk": risk,
            "flags": a.flags,
        })

    # Day-hour heatmap (all artifacts)
    day_hour: list[list[int]] = [[0] * 24 for _ in range(7)]
    for a in artifacts:
        try:
            dt = _parse_time(a.time.value)
            day_hour[dt.weekday()][dt.hour] += 1
        except ValueError:
            continue

    return {
        "total": total,
        "evidence_by_type": evidence_by_type,
        "platforms": platforms,
        "suggestions": suggestions,
        "timeline": timeline,
        "top_evidence": top_evidence,
        "day_hour_activity": day_hour,
    }

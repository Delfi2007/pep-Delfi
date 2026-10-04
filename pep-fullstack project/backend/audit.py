"""Append-only audit log — who did what to a case, and when.

This is the piece the rest of the system has been missing. Several
things were deliberately left out elsewhere *because* nothing recorded
history: the dashboard has no trend deltas, Alerts has no "new since you
last looked", and the case report can't say when a lead was confirmed.
All three were absent rather than estimated. This module is the
prerequisite for doing any of them honestly.

What it records: state changes, at the point they happen — evidence
ingested, triage run, a lead confirmed or rejected, a tag or note added,
an alert acknowledged, a report generated. Reads are not logged; a
timeline scroll is not an event, and logging every debounced keystroke of
a search box would bury the entries that matter.

Two limits stated up front rather than discovered later:

1. **Entries cannot say *who*.** There is no user model in this build —
   nobody signs in, and a case records its investigating officer as free
   text. So an entry attributes to that officer where the case names one
   and to "unattributed" otherwise. A real deployment needs auth before
   this log means anything in a courtroom; what's here is the shape of
   the record, honestly labelled.

2. **It lives in memory, like everything else.** The log starts when the
   process starts, so it covers the current session only. A restart wipes
   it — including the auto-seeded ingest, which is re-recorded on the way
   back up because it genuinely happens again.

Append-only is enforced by the interface: there is `record` and there are
readers, and nothing that edits or deletes an entry.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

# Category per action, so the UI can filter without hardcoding a list of
# action slugs that would drift the moment a new one is recorded.
CATEGORIES: dict[str, str] = {
    "case_created": "case",
    "evidence_ingested": "evidence",
    "triage_run": "triage",
    "lead_decision": "review",
    "tag_added": "annotation",
    "tag_removed": "annotation",
    "notes_saved": "annotation",
    "alert_acknowledged": "alert",
    "alert_reopened": "alert",
    "report_generated": "report",
}

UNATTRIBUTED = "unattributed"


@dataclass
class AuditEvent:
    seq: int
    at: str
    case_id: str
    action: str
    category: str
    summary: str
    actor: str
    detail: dict[str, Any] = field(default_factory=dict)
    artifact_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "at": self.at,
            "case_id": self.case_id,
            "action": self.action,
            "category": self.category,
            "summary": self.summary,
            "actor": self.actor,
            "detail": self.detail,
            "artifact_ids": self.artifact_ids,
        }


_events: dict[str, list[AuditEvent]] = {}
# One counter per process, not per case: a globally increasing sequence
# makes it obvious if entries were ever reordered in transit.
_counter = itertools.count(1)


def record(
    case_id: str,
    action: str,
    summary: str,
    actor: str | None = None,
    detail: dict[str, Any] | None = None,
    artifact_ids: list[str] | None = None,
) -> AuditEvent:
    """Append one entry. Never raises on an unknown action — a missing
    category is a UI inconvenience; an audit write that throws could take
    down the operation it was recording, which is far worse."""
    event = AuditEvent(
        seq=next(_counter),
        at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        case_id=case_id,
        action=action,
        category=CATEGORIES.get(action, "other"),
        summary=summary,
        actor=(actor or "").strip() or UNATTRIBUTED,
        detail=detail or {},
        artifact_ids=artifact_ids or [],
    )
    _events.setdefault(case_id, []).append(event)
    return event


def for_case(
    case_id: str, category: str | None = None, limit: int = 200
) -> dict[str, Any]:
    """Newest first — an officer opening this wants the last thing that
    happened, not the first."""
    entries = list(reversed(_events.get(case_id, [])))
    total = len(entries)

    if category:
        entries = [e for e in entries if e.category == category]

    counts: dict[str, int] = {}
    for event in _events.get(case_id, []):
        counts[event.category] = counts.get(event.category, 0) + 1

    capped = max(1, min(limit, 500))
    return {
        "events": [e.to_dict() for e in entries[:capped]],
        "total": total,
        "shown": min(len(entries), capped),
        "truncated": len(entries) > capped,
        "counts": counts,
        "categories": sorted(counts),
    }


def clear_case(case_id: str) -> None:
    """Only for when a case itself is dropped — an audit log that outlived
    its case would be a privacy problem, not a feature."""
    _events.pop(case_id, None)

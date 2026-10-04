"""Grooming-stage classification for relationship timelines.

Maps the message history between two actors onto recognized grooming
stages using the existing signals.py lexicons plus trust-building
patterns. The classification is deterministic (lexicon + arithmetic),
not model-dependent.

Stages progress through:
  Contact -> Trust-building -> Isolation -> Channel migration
  -> Escalation -> Contact request

A message can only belong to one stage. When no signal fires, the
message inherits the stage of its surrounding context (the current
phase of the relationship). The algorithm assigns stages in temporal
order so the progression reads naturally.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from models import Artifact
from signals import SIGNAL_LEXICONS, _normalize, CONCERN_THRESHOLD

TRUST_BUILDING_PATTERNS: list[str] = [
    r"you.?re (?:so |very )?(?:special|mature|smart|grown.up|different)",
    r"(?:can |you can )tell me anything",
    r"(?:im |i am )?always here for you",
    r"trust me",
    r"(?:im |i am )?proud of you",
    r"no one (?:else )?(?:gets|understands) you",
    r"you make me (?:feel |happy|smile)",
    r"(?:i )?(?:care|worry) about you",
    r"how (?:are|was) (?:you|your)",
    r"good (?:morning|night|evening)",
    r"(?:you are|you.re) (?:beautiful|pretty|handsome|cute|amazing|wonderful)",
    r"miss you",
    r"thinking (?:of|about) you",
    r"you.?re? very? special",
]

_TRUST_COMPILED = [re.compile(p) for p in TRUST_BUILDING_PATTERNS]

STAGE_ORDER = [
    "contact",
    "trust_building",
    "isolation",
    "channel_migration",
    "escalation",
    "contact_request",
]

STAGE_META: dict[str, dict[str, str]] = {
    "contact": {
        "label": "Contact",
        "description": "Initial contact and introduction between actors",
    },
    "trust_building": {
        "label": "Trust-building",
        "description": "Supportive, complimentary, rapport-building language",
    },
    "isolation": {
        "label": "Isolation",
        "description": "Secrecy demands, separating target from support network",
    },
    "channel_migration": {
        "label": "Channel migration",
        "description": "Moving conversation to more private channels",
    },
    "escalation": {
        "label": "Escalation",
        "description": "Age probes, boundary testing, escalating intimacy",
    },
    "contact_request": {
        "label": "Contact request",
        "description": "Requesting meetings, calls, or physical contact",
    },
}

_SIGNAL_TO_STAGE = {
    "isolation": "isolation",
    "channel_migration": "channel_migration",
    "contact_escalation": "contact_request",
    "age_probe": "escalation",
}

_ALL_SIGNAL_COMPILED: dict[str, list[re.Pattern[str]]] = {
    signal: [re.compile(p) for p in patterns]
    for signal, patterns in SIGNAL_LEXICONS.items()
}


def _classify_message(text: str, artifact_type: str) -> str | None:
    normalized = _normalize(text)

    for signal, patterns in _ALL_SIGNAL_COMPILED.items():
        for p in patterns:
            if p.search(normalized):
                return _SIGNAL_TO_STAGE.get(signal)

    for p in _TRUST_COMPILED:
        if p.search(normalized):
            return "trust_building"

    if artifact_type == "call":
        return "contact_request"

    return None


@dataclass
class StageBlock:
    stage: str
    start_date: str
    end_date: str
    artifact_ids: list[str] = field(default_factory=list)
    signal_matches: list[dict[str, str]] = field(default_factory=list)
    message_count: int = 0
    duration_days: int = 0

    def to_dict(self) -> dict[str, Any]:
        meta = STAGE_META.get(self.stage, {})
        return {
            "stage": self.stage,
            "label": meta.get("label", self.stage),
            "description": meta.get("description", ""),
            "start_date": self.start_date,
            "end_date": self.end_date,
            "duration_days": self.duration_days,
            "message_count": self.message_count,
            "artifact_ids": self.artifact_ids,
            "signal_matches": self.signal_matches,
        }


def classify_stages(
    artifacts: list[Artifact],
    content: dict[str, Any],
    actor1: str,
    actor2: str,
    identities: list | None = None,
) -> list[StageBlock]:
    """Classify messages between two actors into grooming stages.

    actor1/actor2 can be any identifier (phone, handle, actor_id).
    When identities are provided, all identifiers that resolve to the
    same actor are treated as matches.
    """

    actor1_ids = {actor1}
    actor2_ids = {actor2}
    if identities is not None:
        for ident in identities:
            ids_set = set(ident.identifiers)
            ids_set.add(ident.actor_id)
            if actor1 in ids_set:
                actor1_ids = ids_set
            if actor2 in ids_set:
                actor2_ids = ids_set

    thread_msgs: list[tuple[Artifact, str | None]] = []

    for a in sorted(artifacts, key=lambda x: x.time.value):
        if a.type not in ("message", "call"):
            continue
        actors_set = set(a.actors)
        has_actor1 = bool(actors_set & actor1_ids)
        has_actor2 = bool(actors_set & actor2_ids)
        if not (has_actor1 and has_actor2):
            continue

        payload = content.get(a.content_ref) or {}
        text = payload.get("text", "")
        stage = _classify_message(text, a.type)
        thread_msgs.append((a, stage))

    if not thread_msgs:
        return []

    n = len(thread_msgs)
    first_n = max(3, n // 10)
    for i in range(min(first_n, n)):
        a, stage = thread_msgs[i]
        if stage is None:
            thread_msgs[i] = (a, "contact")

    assigned: list[tuple[Artifact, str]] = []
    current_stage = "contact"
    for a, stage in thread_msgs:
        if stage is not None:
            current_stage = stage
        assigned.append((a, current_stage))

    blocks: list[StageBlock] = []
    current_block: StageBlock | None = None

    for a, stage in assigned:
        date_str = a.time.value[:10]
        payload = content.get(a.content_ref) or {}
        text = payload.get("text", "")

        if current_block is None or current_block.stage != stage:
            if current_block is not None:
                blocks.append(current_block)
            current_block = StageBlock(
                stage=stage,
                start_date=date_str,
                end_date=date_str,
                message_count=0,
            )

        current_block.end_date = date_str
        current_block.message_count += 1
        current_block.artifact_ids.append(a.artifact_id)

        classified = _classify_message(text, a.type)
        if classified is not None:
            current_block.signal_matches.append({
                "artifact_id": a.artifact_id,
                "signal": classified,
                "matched": text[:80],
            })

    if current_block is not None:
        blocks.append(current_block)

    for block in blocks:
        try:
            start = datetime.strptime(block.start_date, "%Y-%m-%d")
            end = datetime.strptime(block.end_date, "%Y-%m-%d")
            block.duration_days = max(1, (end - start).days + 1)
        except ValueError:
            block.duration_days = 1

    return blocks


def get_stage_summary(
    artifacts: list[Artifact],
    content: dict[str, Any],
    actor1: str,
    actor2: str,
    stage: str,
    identities: list | None = None,
) -> dict[str, Any]:
    """Get a summary for a specific stage block between two actors."""
    blocks = classify_stages(artifacts, content, actor1, actor2, identities)
    target = None
    for b in blocks:
        if b.stage == stage:
            target = b
            break

    if target is None:
        return {"error": f"Stage '{stage}' not found for this pair"}

    meta = STAGE_META.get(stage, {})
    signal_count = len(target.signal_matches)
    pct = round(signal_count / target.message_count * 100) if target.message_count > 0 else 0

    summary_text = (
        f"Over {target.duration_days} day(s), {target.message_count} messages "
        f"exchanged. {signal_count} ({pct}%) matched {meta.get('label', stage)} "
        f"signals."
    )

    return {
        "stage": stage,
        "label": meta.get("label", stage),
        "description": meta.get("description", ""),
        "summary": summary_text,
        "message_count": target.message_count,
        "signal_match_count": signal_count,
        "signal_match_pct": pct,
        "duration_days": target.duration_days,
        "start_date": target.start_date,
        "end_date": target.end_date,
        "cited_artifacts": target.artifact_ids[:10],
    }

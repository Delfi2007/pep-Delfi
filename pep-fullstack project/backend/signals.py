"""Grooming-pattern signal features — ACPIA_Plan.md section 5.

The plan's line on this is the reason this module is deterministic rather
than a model call:

    Off-the-shelf sentiment analysis fails here. Grooming language is warm
    and complimentary — a sentiment model scores it positive. We score
    trajectory and structure instead.

So: lexicons for the two tactics that are lexical (isolation, channel
migration), and arithmetic over the timeline for the two that are
structural (escalation slope, asymmetry). Age-gap indicators are the one
genuinely-language problem and are left to the agent in triage.py; what
lives here is the cheap `age_probe` lexicon that flags *asking*, which is
a pattern, not a judgement.

Two design rules that matter for credibility:

1. **Signals are attributed to the author, never the thread.** A minor
   replying "okay i won't tell anyone" is evidence *about* the suspect's
   isolation tactic, not evidence the minor is isolating someone. Every
   hit is scored against `content["sender"]`, which the parsers guarantee
   is a resolvable identifier (see parsers.py line 99).

2. **Every aggregate carries the artifact IDs it was computed from.** The
   citation guard in triage.py can only validate what it can trace, and
   the rule-based fallback has to be as citable as the agent is.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from models import Artifact, ResolvedActor

# Max evidence IDs retained per signal per actor. The agent doesn't need
# all 40 isolation hits to make a case, and an unbounded list would blow
# out the tool-result payload.
MAX_EVIDENCE_PER_SIGNAL = 8

# The line above which an actor is treated as a person of concern. Lives
# here, next to the scoring that produces the number, because three
# separate consumers ask the question — rule-based triage, the Persons of
# interest view, and the case report — and a case where they disagreed
# about who is of concern would be indefensible.
CONCERN_THRESHOLD = 0.25

# Lexicons. Deliberately phrase-level rather than keyword-level: "secret"
# alone fires on "can you keep a secret about the surprise party", while
# "our secret" is a tactic. Patterns are matched against lowercased text
# with apostrophes normalised, so "don't"/"dont" both hit one pattern.
SIGNAL_LEXICONS: dict[str, list[str]] = {
    "isolation": [
        r"dont tell (?:your |any)?\w*",
        r"our (?:little )?secret",
        r"between us",
        r"wouldn?t (?:really )?understand",
        r"not like the other kids",
        r"trust you more than",
        r"wont judge you",
        r"they wouldnt get it",
    ],
    "channel_migration": [
        r"what.?s your number",
        r"my number.?s?\b",
        r"save my number",
        r"(?:move|switch) to whatsapp",
        r"text me on \w+",
        r"delete this chat",
        r"too many people watching",
        r"more private",
        r"add me on \w+",
    ],
    "contact_escalation": [
        r"can we call",
        r"call me",
        r"call tonight",
        r"call you later",
        r"call instead of texting",
        r"why didn?t you pick up",
        r"you up\b",
    ],
    # Probes only — the *asking*, never the answering. A child replying
    # "grade 6" is disclosing their age, which is evidence about the
    # thread but is not a tactic, and must not score against the child.
    # (Echo suppression would catch most of these anyway; keeping the
    # lexicon itself honest means we don't depend on turn order.)
    "age_probe": [
        r"what grade are you in",
        r"how old are you",
        r"for your age",
        r"\b1[0-7] already",
        r"kids your age",
    ],
}

_COMPILED: dict[str, list[re.Pattern[str]]] = {
    signal: [re.compile(p) for p in patterns] for signal, patterns in SIGNAL_LEXICONS.items()
}

# Escalation and migration are the two tactics whose *timing* carries
# meaning — both should appear late in a thread if the thread is a
# grooming progression rather than a friendship.
TRAJECTORY_SIGNALS = ("channel_migration", "contact_escalation")

LATE_NIGHT_HOURS = {22, 23, 0, 1, 2}


def _normalize(text: str) -> str:
    """Lowercase and strip the apostrophe variants so one pattern covers
    "don't", "dont", and the curly-quote form an export might carry."""
    return text.lower().replace("’", "").replace("'", "")


@dataclass
class SignalHit:
    artifact_id: str
    signal: str
    author: str
    counterparties: list[str]
    matched: str
    time: str
    echo: bool = False
    """True when the *other* party in this thread used this same signal
    earlier — see `_mark_echoes`."""


@dataclass
class _ThreadStats:
    """One directed author -> counterparty conversation."""

    times: list[datetime] = field(default_factory=list)
    trajectory_times: list[datetime] = field(default_factory=list)
    message_count: int = 0


@dataclass
class ActorSignalProfile:
    actor_id: str
    label: str
    identifiers: list[str]
    messages_authored: int
    counterparties: list[str]
    signal_counts: dict[str, int]
    signal_evidence: dict[str, list[str]]
    late_night_ratio: float
    escalation_slope: float
    asymmetry: float
    risk_score: float
    channels: list[str]
    hourly_activity: list[int] = field(default_factory=lambda: [0] * 24)
    peak_hours: str | None = None
    day_hour_activity: list[list[int]] = field(default_factory=lambda: [[0] * 24 for _ in range(7)])
    weekly_trend: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "actor_id": self.actor_id,
            "label": self.label,
            "identifiers": self.identifiers,
            "messages_authored": self.messages_authored,
            "counterparties": self.counterparties,
            "signal_counts": self.signal_counts,
            "signal_evidence": self.signal_evidence,
            "late_night_ratio": round(self.late_night_ratio, 3),
            "escalation_slope": round(self.escalation_slope, 3),
            "asymmetry": round(self.asymmetry, 3),
            "risk_score": round(self.risk_score, 3),
            "channels": self.channels,
            "hourly_activity": self.hourly_activity,
            "peak_hours": self.peak_hours,
            "day_hour_activity": self.day_hour_activity,
            "weekly_trend": self.weekly_trend,
        }


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _peak_range(hours: list[int]) -> str | None:
    if sum(hours) == 0:
        return None
    peak_hour = max(range(24), key=lambda h: hours[h])
    end_hour = (peak_hour + 3) % 24
    return f"{peak_hour:02d}:00–{end_hour:02d}:00"


def _ident_to_actor(identities: list[ResolvedActor]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for actor in identities:
        for ident in actor.identifiers:
            mapping[ident] = actor.actor_id
    return mapping


def _mark_echoes(hits: list[SignalHit]) -> None:
    """Suppress a signal when the author is only *echoing* it back.

    A minor answering "okay i won't tell anyone" matches the isolation
    lexicon, and naively that scores the child as running an isolation
    tactic — which is both wrong and the fastest way to lose a room. The
    child's reply is evidence *about* the suspect, not against the child.

    The rule: within one thread, per signal, whoever uses it first owns
    it. Every later use by a different party in that same thread is an
    echo and does not score. Note this is per-signal and per-thread, so an
    actor who genuinely introduces a tactic in their own thread is still
    scored for it — echo status is never inherited across conversations.

    Echoed hits are kept in the returned list rather than dropped: the
    agent can legitimately cite "the child agreed to keep it secret" as
    corroboration, it just must not inflate the child's risk score.
    """
    first_use: dict[tuple[frozenset[str], str], str] = {}

    for hit in sorted(hits, key=lambda h: h.time):
        thread = frozenset([hit.author, *hit.counterparties])
        key = (thread, hit.signal)
        owner = first_use.setdefault(key, hit.author)
        if owner != hit.author:
            hit.echo = True


def extract_signal_hits(
    artifacts: list[Artifact], content: dict[str, Any]
) -> list[SignalHit]:
    """Every lexicon match in the case, attributed to its author."""
    hits: list[SignalHit] = []

    for artifact in artifacts:
        if artifact.type != "message":
            continue
        payload = content.get(artifact.content_ref) or {}
        text = payload.get("text") or ""
        author = payload.get("sender")
        if not text or not author:
            continue

        normalized = _normalize(text)
        counterparties = [a for a in artifact.actors if a != author]

        for signal, patterns in _COMPILED.items():
            for pattern in patterns:
                match = pattern.search(normalized)
                if match:
                    hits.append(
                        SignalHit(
                            artifact_id=artifact.artifact_id,
                            signal=signal,
                            author=author,
                            counterparties=counterparties,
                            matched=match.group(0),
                            time=artifact.time.value,
                        )
                    )
                    break  # one hit per signal per message, not per phrase

    _mark_echoes(hits)
    return hits


def _escalation_slope(stats: _ThreadStats) -> float:
    """Rate of migration/escalation asks in the back half of a thread minus
    the rate in the front half, split at the thread's own midpoint in
    *time* (not by message index — a thread that goes quiet then spikes
    should read as escalating).

    Range is roughly -1..1. Positive means the asks cluster late, which is
    the grooming progression; a friendship that always talked about
    calling scores ~0 because the rate never changes.
    """
    if stats.message_count < 4 or not stats.times:
        return 0.0

    start, end = min(stats.times), max(stats.times)
    span = (end - start).total_seconds()
    if span <= 0:
        return 0.0
    midpoint = start.timestamp() + span / 2

    early_msgs = sum(1 for t in stats.times if t.timestamp() < midpoint)
    late_msgs = stats.message_count - early_msgs
    if early_msgs == 0 or late_msgs == 0:
        return 0.0

    early_hits = sum(1 for t in stats.trajectory_times if t.timestamp() < midpoint)
    late_hits = len(stats.trajectory_times) - early_hits

    return (late_hits / late_msgs) - (early_hits / early_msgs)


def _risk_score(
    signal_counts: dict[str, int],
    counterparty_count: int,
    late_night_ratio: float,
    escalation_slope: float,
    messages_authored: int,
) -> float:
    """A readable weighted sum, in the spirit of the plan's "a rule you can
    read beats a score you can't". Counts are converted to per-message
    rates first so a chatty friend doesn't outrank a suspect on volume.

    Weights encode what investigators actually treat as serious: isolation
    language and channel migration are tactics with no innocent reading at
    volume, so they dominate; late-night activity is contextual and only
    nudges.
    """
    if messages_authored == 0:
        return 0.0

    rate = lambda signal: signal_counts.get(signal, 0) / messages_authored  # noqa: E731

    score = (
        0.34 * min(rate("isolation") * 4, 1.0)
        + 0.24 * min(rate("channel_migration") * 6, 1.0)
        + 0.14 * min(rate("age_probe") * 6, 1.0)
        + 0.16 * max(escalation_slope, 0.0)
        + 0.12 * late_night_ratio
    )

    # Contacting several minors with the same pattern is the single
    # strongest signal in the case — one thread is an allegation, four
    # threads running the same playbook is a method.
    if counterparty_count >= 3 and score > 0.1:
        score = min(score * 1.35, 1.0)

    return min(score, 1.0)


def build_profiles(
    artifacts: list[Artifact],
    content: dict[str, Any],
    identities: list[ResolvedActor],
) -> list[ActorSignalProfile]:
    """Aggregate signal hits into one profile per resolved actor, ranked by
    risk score. This is both the agent's evidence tool and — per the
    fallback ladder, plan section 7 — the rule-based triage that runs when
    the agent is unavailable."""
    ident_to_actor = _ident_to_actor(identities)
    actor_by_id = {a.actor_id: a for a in identities}

    hits = extract_signal_hits(artifacts, content)

    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    evidence: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for hit in hits:
        if hit.echo:
            continue
        actor_id = ident_to_actor.get(hit.author)
        if actor_id is None:
            continue
        counts[actor_id][hit.signal] += 1
        bucket = evidence[actor_id][hit.signal]
        if len(bucket) < MAX_EVIDENCE_PER_SIGNAL:
            bucket.append(hit.artifact_id)

    # Authored-message tallies, thread stats, and late-night rates.
    authored: dict[str, int] = defaultdict(int)
    late_night: dict[str, int] = defaultdict(int)
    counterparties: dict[str, set[str]] = defaultdict(set)
    threads: dict[tuple[str, str], _ThreadStats] = defaultdict(_ThreadStats)
    trajectory_ids = {
        h.artifact_id for h in hits if h.signal in TRAJECTORY_SIGNALS and not h.echo
    }

    hourly: dict[str, list[int]] = defaultdict(lambda: [0] * 24)
    day_hour: dict[str, list[list[int]]] = defaultdict(lambda: [[0] * 24 for _ in range(7)])
    weekly_buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for artifact in artifacts:
        if artifact.type != "message":
            continue
        payload = content.get(artifact.content_ref) or {}
        author = payload.get("sender")
        if not author:
            continue
        actor_id = ident_to_actor.get(author)
        if actor_id is None:
            continue

        when = _parse_time(artifact.time.value)
        authored[actor_id] += 1
        hourly[actor_id][when.hour] += 1
        day_hour[actor_id][when.weekday()][when.hour] += 1
        week_key = when.strftime("%Y-W%W")
        weekly_buckets[actor_id][week_key] += 1
        if when.hour in LATE_NIGHT_HOURS:
            late_night[actor_id] += 1

        for other in artifact.actors:
            if other == author:
                continue
            other_actor = ident_to_actor.get(other)
            if other_actor is None or other_actor == actor_id:
                continue
            counterparties[actor_id].add(other_actor)

            stats = threads[(actor_id, other_actor)]
            stats.message_count += 1
            stats.times.append(when)
            if artifact.artifact_id in trajectory_ids:
                stats.trajectory_times.append(when)

    profiles: list[ActorSignalProfile] = []
    for actor_id, message_count in authored.items():
        actor = actor_by_id.get(actor_id)
        if actor is None:
            continue

        actor_threads = [s for (a, _), s in threads.items() if a == actor_id]
        slope = (
            max(_escalation_slope(s) for s in actor_threads) if actor_threads else 0.0
        )

        # Asymmetry: how one-sided this actor's conversations are. A
        # suspect driving four threads authors far more than they receive.
        received = sum(
            s.message_count for (_, b), s in threads.items() if b == actor_id
        )
        total = message_count + received
        asymmetry = (message_count / total) if total else 0.0

        ln_ratio = late_night[actor_id] / message_count if message_count else 0.0
        signal_counts = dict(counts.get(actor_id, {}))

        actor_hourly = hourly.get(actor_id, [0] * 24)
        peak = _peak_range(actor_hourly)
        wb = weekly_buckets.get(actor_id, {})
        weekly = [wb[k] for k in sorted(wb.keys())] if wb else []

        profiles.append(
            ActorSignalProfile(
                actor_id=actor_id,
                label=actor.label,
                identifiers=actor.identifiers,
                messages_authored=message_count,
                counterparties=sorted(
                    actor_by_id[c].label for c in counterparties[actor_id] if c in actor_by_id
                ),
                signal_counts=signal_counts,
                signal_evidence={k: list(v) for k, v in evidence.get(actor_id, {}).items()},
                late_night_ratio=ln_ratio,
                escalation_slope=slope,
                asymmetry=asymmetry,
                risk_score=_risk_score(
                    signal_counts,
                    len(counterparties[actor_id]),
                    ln_ratio,
                    slope,
                    message_count,
                ),
                channels=actor.channels,
                hourly_activity=actor_hourly,
                peak_hours=peak,
                day_hour_activity=day_hour.get(actor_id, [[0] * 24 for _ in range(7)]),
                weekly_trend=weekly,
            )
        )

    profiles.sort(key=lambda p: p.risk_score, reverse=True)
    return profiles

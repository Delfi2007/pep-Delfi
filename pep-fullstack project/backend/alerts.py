"""Alerts — conditions in the evidence that warrant an officer's attention.

Every alert is a rule you can read, fired by arithmetic over the same
deterministic layer the Persons of interest view and rule-based triage
use. No model is involved, and each alert carries the artifact IDs it
fired on, so "why am I seeing this" is always answerable by clicking
through to the evidence.

Three rules about what may fire, and they matter as much as the
detections themselves:

1. **Actor-level alerts only fire for actors at or above the concern
   threshold.** Late-night activity, age probes and channel-migration
   asks all have innocent readings in isolation, and a victim's own
   late-night ratio is not a fact about the victim. Gating on the same
   `CONCERN_THRESHOLD` the People tab and triage use means an alert can
   never be raised *about* a child in this case.

2. **No unread state, no "3 new alerts" badge.** Nothing in this build
   records when an officer last looked, so a "new since" count could only
   be invented — the same reason the dashboard carries no trend deltas.
   What exists instead is explicit acknowledgement: an officer marks an
   alert acknowledged and that is recorded, because it actually happened.

3. **An alert is a condition detected, never a conclusion.** The wording
   says what was counted and what rule fired, and leaves the judgement to
   the officer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from correlation import Correlation
from models import Artifact, ResolvedActor
from signals import CONCERN_THRESHOLD, ActorSignalProfile

# Severity ordering, most serious first. Mirrors the triage panel's
# priority colours so one colour keeps meaning one thing in the console.
SEVERITY_ORDER = ("critical", "high", "medium")

# A message and a call within this correlation score of each other are
# close enough in time, and cross-modality, to read as "the ask, then the
# call" rather than coincidence. 0.7 with the scoring in correlation.py is
# roughly a cross-type pair inside ~10 minutes.
CALL_LINK_SCORE = 0.7

# Rule thresholds, named rather than inlined so the alert text and the
# condition can't drift apart.
MULTI_CONTACT_MIN = 3
CROSS_CHANNEL_MIN = 3
CHANNEL_MIGRATION_MIN = 3
LATE_NIGHT_MIN_RATIO = 0.2
LATE_NIGHT_MIN_MESSAGES = 20
MAX_CALL_LINK_ALERTS = 5


@dataclass
class Alert:
    alert_id: str
    rule: str
    severity: str
    title: str
    detail: str
    # The rule in plain words. Shown in the UI: an alert an officer can't
    # interrogate is one they'll learn to ignore.
    why: str
    actor: str | None = None
    evidence: list[str] = field(default_factory=list)
    time: str | None = None
    acknowledged: bool = False
    # A number this alert genuinely has, with a label saying what it is —
    # an actor's risk score, or a correlation score. Deliberately optional:
    # a known-hash match has no score at all (it's an exact byte match,
    # not a ranking), and inventing one so every card has a figure in the
    # same slot would be a fabrication in the most load-bearing column on
    # the screen.
    score: float | None = None
    score_label: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "rule": self.rule,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
            "why": self.why,
            "actor": self.actor,
            "evidence": self.evidence,
            "time": self.time,
            "acknowledged": self.acknowledged,
            "score": self.score,
            "score_label": self.score_label,
        }


def _concern_profiles(profiles: list[ActorSignalProfile]) -> list[ActorSignalProfile]:
    return [p for p in profiles if p.risk_score >= CONCERN_THRESHOLD]


def _hash_match_alerts(artifacts: list[Artifact]) -> list[Alert]:
    """Two rules under one roof: exact SHA-256 and perceptual pHash.

    An artifact can carry both flags — an SHA-flagged image whose pHash
    also happens to match a reference — but the SHA claim is stronger, so
    when both are present only the SHA alert fires. The pHash alert would
    otherwise mislead: its "why" copy says "SHA-256 differs — this is a
    re-encoded, resized, or recoloured copy", which is literally false for
    a byte-identical match. Emitting one alert per artifact per rule
    contract, with SHA taking precedence, keeps the count honest and the
    text accurate.
    """
    alerts: list[Alert] = []
    for artifact in artifacts:
        if not artifact.flags:
            continue

        sha_matched = any(f == "hash_match:sha256" for f in artifact.flags)
        phash_flag = next(
            (f for f in artifact.flags if f.startswith("hash_match:phash")), None
        )

        if sha_matched:
            alerts.append(
                Alert(
                    alert_id=f"hash_match_sha256:{artifact.artifact_id}",
                    rule="hash_match_sha256",
                    severity="critical",
                    title="Known-hash image match",
                    detail=(
                        f"{artifact.source} matches an entry in the known-hash list "
                        "(SHA-256 exact match)."
                    ),
                    why=(
                        "The file's SHA-256 is byte-identical to a hash on the known "
                        "list. This is an exact match, not a similarity score."
                    ),
                    evidence=[artifact.artifact_id],
                    time=artifact.time.value,
                )
            )
            continue  # SHA wins — do not also emit a pHash alert for this artifact

        if phash_flag is not None:
            # Flag shape: "hash_match:phash:<distance>". Anything malformed
            # is treated as unknown distance rather than crashing the alert
            # pipeline over one bad flag string.
            parts = phash_flag.split(":")
            try:
                distance = int(parts[2]) if len(parts) >= 3 else None
            except ValueError:
                distance = None

            distance_text = (
                f"Hamming distance {distance} of 64"
                if distance is not None
                else "within the perceptual-hash threshold"
            )
            alerts.append(
                Alert(
                    alert_id=f"hash_match_phash:{artifact.artifact_id}",
                    rule="hash_match_phash",
                    severity="critical",
                    title="Perceptual match to a known-hash image",
                    detail=(
                        f"{artifact.source} is perceptually similar to a reference "
                        f"on the known-hash list ({distance_text})."
                    ),
                    why=(
                        "The image is a near-duplicate of a known reference — its "
                        "SHA-256 differs, so a byte-identical hash check would miss "
                        "it, but its perceptual hash sits within the near-duplicate "
                        "threshold. This is what a chat app re-encoding, a light "
                        "recolour, or a small resize typically produces."
                    ),
                    evidence=[artifact.artifact_id],
                    time=artifact.time.value,
                    # SHA-256 has no score (it's an exact match, not a
                    # ranking). pHash does — the Hamming distance — and
                    # populating the score slot here rather than leaving
                    # it blank is the visible payoff of the split.
                    score=float(distance) if distance is not None else None,
                    score_label="Hamming distance" if distance is not None else None,
                )
            )

    return alerts


def _actor_alerts(profiles: list[ActorSignalProfile]) -> list[Alert]:
    alerts: list[Alert] = []

    for profile in _concern_profiles(profiles):
        evidence = list(
            dict.fromkeys(e for ids in profile.signal_evidence.values() for e in ids[:2])
        )[:6]

        alerts.append(
            Alert(
                alert_id=f"concern_actor:{profile.actor_id}",
                rule="concern_actor",
                severity="critical" if profile.risk_score >= 0.6 else "high",
                title=f"{profile.label} scores above the concern threshold",
                detail=(
                    f"Risk score {profile.risk_score:.2f} from {profile.messages_authored} "
                    f"authored messages across {len(profile.channels)} channels."
                ),
                why=(
                    f"Deterministic signal scoring placed this actor at or above "
                    f"{CONCERN_THRESHOLD:.2f}. Signals are attributed to the message "
                    "author, and phrases echoed back by the other party are excluded."
                ),
                actor=profile.label,
                evidence=evidence,
                score=round(profile.risk_score, 2),
                score_label="Actor risk",
            )
        )

        if len(profile.counterparties) >= MULTI_CONTACT_MIN:
            alerts.append(
                Alert(
                    alert_id=f"multi_contact:{profile.actor_id}",
                    rule="multi_contact",
                    severity="critical",
                    title=f"{profile.label} shows the same pattern against "
                    f"{len(profile.counterparties)} contacts",
                    detail=(
                        "Contacts: " + ", ".join(profile.counterparties) + "."
                    ),
                    why=(
                        f"An actor above the concern threshold is in contact with "
                        f"{MULTI_CONTACT_MIN} or more separate counterparties. One thread "
                        "is an allegation; the same approach repeated across several is a "
                        "method, and it is the single strongest pattern in a case like this."
                    ),
                    actor=profile.label,
                    evidence=evidence,
                    score=round(profile.risk_score, 2),
                    score_label="Actor risk",
                )
            )

        migration = profile.signal_counts.get("channel_migration", 0)
        if migration >= CHANNEL_MIGRATION_MIN:
            alerts.append(
                Alert(
                    alert_id=f"channel_migration:{profile.actor_id}",
                    rule="channel_migration",
                    severity="high",
                    title=f"{profile.label} repeatedly pushed to move platform",
                    detail=(
                        f"{migration} messages asking to move platform, swap numbers or "
                        "delete the conversation."
                    ),
                    why=(
                        "Moving a conversation off a monitored platform, or asking for it "
                        "to be deleted, is a documented grooming step. The count is of "
                        "phrases this actor introduced, not ones they replied to."
                    ),
                    actor=profile.label,
                    evidence=profile.signal_evidence.get("channel_migration", [])[:6],
                    score=round(profile.risk_score, 2),
                    score_label="Actor risk",
                )
            )

        probes = profile.signal_counts.get("age_probe", 0)
        if probes:
            alerts.append(
                Alert(
                    alert_id=f"age_probe:{profile.actor_id}",
                    rule="age_probe",
                    severity="high",
                    title=f"{profile.label} probed for age or school year",
                    detail=f"{probes} messages asking age, grade or school year.",
                    why=(
                        "The lexicon matches the *asking* only. A child answering with "
                        "their age is a disclosure and is never scored against them."
                    ),
                    actor=profile.label,
                    evidence=profile.signal_evidence.get("age_probe", [])[:6],
                    score=round(profile.risk_score, 2),
                    score_label="Actor risk",
                )
            )

        if (
            profile.late_night_ratio >= LATE_NIGHT_MIN_RATIO
            and profile.messages_authored >= LATE_NIGHT_MIN_MESSAGES
        ):
            alerts.append(
                Alert(
                    alert_id=f"late_night:{profile.actor_id}",
                    rule="late_night",
                    severity="medium",
                    title=f"{profile.label} contacts concentrated late at night",
                    detail=(
                        f"{profile.late_night_ratio:.0%} of their messages fall between "
                        "22:00 and 02:00."
                    ),
                    why=(
                        "Late-night contact is contextual on its own — it only fires here "
                        "for an actor already above the concern threshold, so it is never "
                        "raised about a child whose own messages happen to be late."
                    ),
                    actor=profile.label,
                    evidence=evidence,
                    score=round(profile.late_night_ratio, 2),
                    score_label="Late-night share",
                )
            )

    return alerts


def _cross_channel_alerts(
    identities: list[ResolvedActor], profiles: list[ActorSignalProfile]
) -> list[Alert]:
    concern_ids = {p.actor_id for p in _concern_profiles(profiles)}
    alerts: list[Alert] = []

    for actor in identities:
        if actor.actor_id not in concern_ids:
            continue
        if len(actor.channels) < CROSS_CHANNEL_MIN:
            continue
        alerts.append(
            Alert(
                alert_id=f"cross_channel:{actor.actor_id}",
                rule="cross_channel",
                severity="high",
                title=f"{actor.label} resolves across {len(actor.channels)} channels",
                detail=(
                    "Identifiers "
                    + ", ".join(actor.identifiers)
                    + " appear on "
                    + ", ".join(actor.channels)
                    + "."
                ),
                why=(
                    "Identity resolution merged these identifiers because one was "
                    "self-reported inside a message — a channel migration that actually "
                    "succeeded. A call's caller/callee never licenses a merge."
                ),
                actor=actor.label,
                evidence=actor.artifact_ids[:6],
                score=len(actor.channels),
                score_label="Channels",
            )
        )
    return alerts


def _call_escalation_alerts(
    artifacts: list[Artifact],
    correlations: dict[str, list[Correlation]],
    profiles: list[ActorSignalProfile],
) -> list[Alert]:
    """A message closely followed by a voice call to the same person — the
    pattern an investigator circles on paper."""
    concern_identifiers: set[str] = set()
    for profile in _concern_profiles(profiles):
        concern_identifiers.update(profile.identifiers)
    if not concern_identifiers:
        return []

    by_id = {a.artifact_id: a for a in artifacts}

    # Collect every qualifying (message, call) pair first, then keep the
    # strongest per call. Several messages in one exchange all correlate
    # to the call that followed them, and three alerts about a single call
    # is noise that teaches an officer to scroll past the section. Taking
    # the first message to claim the call would pick by artifact ID, which
    # is arbitrary — the closest message is the one worth showing.
    candidates: list[tuple[float, Artifact, Artifact]] = []

    for artifact_id, links in correlations.items():
        artifact = by_id.get(artifact_id)
        if artifact is None or artifact.type != "message":
            continue
        if not (set(artifact.actors) & concern_identifiers):
            continue

        for link in links:
            other = by_id.get(link.artifact_id)
            if other is None or other.type != "call":
                continue
            if link.score < CALL_LINK_SCORE:
                continue
            if other.time.value < artifact.time.value:
                continue  # the call must follow the message, not precede it
            candidates.append((link.score, artifact, other))

    candidates.sort(key=lambda c: c[0], reverse=True)

    alerts: list[Alert] = []
    seen_calls: set[str] = set()
    for score, message, call in candidates:
        if call.artifact_id in seen_calls:
            continue
        seen_calls.add(call.artifact_id)
        alerts.append(
            Alert(
                alert_id=f"message_to_call:{message.artifact_id}:{call.artifact_id}",
                rule="message_to_call",
                severity="high",
                title="Voice call follows a message shortly after",
                detail=(
                    f"Call {call.artifact_id} follows message {message.artifact_id}, "
                    f"correlation score {score:.2f}."
                ),
                why=(
                    "The correlation engine scores temporal proximity and gives "
                    "cross-modality pairs a bump: a message and then a voice call to "
                    "the same person is a different event from two more messages."
                ),
                evidence=[message.artifact_id, call.artifact_id],
                time=message.time.value,
                score=round(score, 2),
                score_label="Correlation",
            )
        )
        if len(alerts) >= MAX_CALL_LINK_ALERTS:
            break

    return alerts


def build_alerts(
    artifacts: list[Artifact],
    identities: list[ResolvedActor],
    profiles: list[ActorSignalProfile],
    correlations: dict[str, list[Correlation]],
    acknowledged: set[str],
) -> dict[str, Any]:
    alerts: list[Alert] = []
    alerts.extend(_hash_match_alerts(artifacts))
    alerts.extend(_actor_alerts(profiles))
    alerts.extend(_cross_channel_alerts(identities, profiles))
    alerts.extend(_call_escalation_alerts(artifacts, correlations, profiles))

    for alert in alerts:
        alert.acknowledged = alert.alert_id in acknowledged

    # Unacknowledged first — an acknowledged alert stays visible and
    # auditable rather than disappearing, but it stops competing for
    # attention with the ones nobody has looked at.
    alerts.sort(
        key=lambda a: (a.acknowledged, SEVERITY_ORDER.index(a.severity), a.alert_id)
    )

    counts = {severity: 0 for severity in SEVERITY_ORDER}
    for alert in alerts:
        if not alert.acknowledged:
            counts[alert.severity] += 1

    return {
        "alerts": [a.to_dict() for a in alerts],
        "total": len(alerts),
        "open": sum(1 for a in alerts if not a.acknowledged),
        "acknowledged": sum(1 for a in alerts if a.acknowledged),
        # Open counts per severity. Deliberately not "new since last
        # visit": nothing records when an officer last looked, so that
        # number could only be invented.
        "counts": counts,
    }

"""Correlation engine -- ACPIA_Plan.md section 4.

Windowed range query over the sorted timeline (bisect), scored:
    proximity = exp(-gap_seconds / 1800)
    modality  = 1.4 if a.type != b.type else 1.0
    score     = proximity * modality

The cross-channel bump is the point: message -> voice call to the same
person shortly after is the pattern an investigator circles on paper.

A candidate only counts as "linked" if it shares at least one resolved
actor with the artifact being scored. Note this can't require the full
actor *pair* to match: a kid's WhatsApp identity ("Aisha", the name) and
her call-log identity (her raw phone number) are deliberately different
resolved actors when nothing bridges them (see identity.py) -- so a
WhatsApp message and a call it's anchored near only ever share the
*predator's* identifier, never the kid's. Requiring one shared actor,
inside a tight 3-hour window, with top-K ranking by score, keeps this
from being noisy: a busy actor's artifacts don't all "link" to each
other, only the temporally close ones surface.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from datetime import datetime

from models import Artifact, ResolvedActor

WINDOW_SECONDS = 3 * 3600  # candidates considered up to 3 hours apart
TOP_K = 5


@dataclass
class Correlation:
    artifact_id: str
    score: float


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _actor_ids(artifact: Artifact, ident_to_actor: dict[str, str]) -> set[str]:
    idents = (
        artifact.actors
        + artifact.entities.handles
        + artifact.entities.phones
        + artifact.entities.emails
    )
    return {ident_to_actor[i] for i in idents if i in ident_to_actor}


def compute_linked_artifacts(
    artifacts: list[Artifact], identities: list[ResolvedActor]
) -> dict[str, list[Correlation]]:
    if not artifacts:
        return {}

    ident_to_actor: dict[str, str] = {}
    for actor in identities:
        for ident in actor.identifiers:
            ident_to_actor[ident] = actor.actor_id

    ordered = sorted(artifacts, key=lambda a: a.time.value)
    epochs = [_parse_time(a.time.value).timestamp() for a in ordered]
    actor_sets = [_actor_ids(a, ident_to_actor) for a in ordered]

    result: dict[str, list[Correlation]] = {}

    for i, artifact in enumerate(ordered):
        t = epochs[i]
        lo = bisect.bisect_left(epochs, t - WINDOW_SECONDS)
        hi = bisect.bisect_right(epochs, t + WINDOW_SECONDS)

        candidates: list[Correlation] = []
        if not actor_sets[i]:
            result[artifact.artifact_id] = []
            continue

        for j in range(lo, hi):
            if j == i:
                continue
            if not (actor_sets[i] & actor_sets[j]):
                continue
            gap = abs(epochs[j] - t)
            proximity = math.exp(-gap / 1800)
            modality = 1.4 if ordered[j].type != artifact.type else 1.0
            candidates.append(Correlation(artifact_id=ordered[j].artifact_id, score=proximity * modality))

        candidates.sort(key=lambda c: c.score, reverse=True)
        result[artifact.artifact_id] = candidates[:TOP_K]

    return result

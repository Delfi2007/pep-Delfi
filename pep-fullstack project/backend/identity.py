"""Union-find identity resolution — ACPIA_Plan.md section 4.

"Two identifiers co-occurring inside one artifact means one actor." That
rule can't be applied blindly to every field: a call log row's `actors`
are the caller and callee -- obviously two different people, not one
merged identity, even though they "co-occur" in the same artifact. What
actually licenses a merge is an artifact *self-reporting* multiple
identifiers for the same person: a message where the sender's own phone
number appears in the text (our migration-request pattern), or an image
whose EXIF leaks an owner's number. Both of those show up in
`entities`, authored by/about one person -- never in `actors`, which is
reserved for "who's involved" rather than "who is this."

So the merge scan reads only `entities.{handles,phones,emails}`, and
only from artifact types where that distinction actually holds
(`message`, `image`). `call` and `browser_history` artifacts still
contribute their identifiers to *membership* (which resolved actor this
artifact belongs to, for the timeline/graph), just never to a merge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from models import Artifact, ResolvedActor

MERGE_ELIGIBLE_TYPES = {"message", "image"}

_PHONE_LIKE = re.compile(r"^\+?\d[\d\s-]{6,}$")


def normalize_identifier(raw: str) -> str:
    """Phones to E.164-ish (strip separators, keep a leading +). Anything
    else (names, handles) passed through as-is -- lowercasing would lose
    real display information for a case that doesn't need it."""
    raw = raw.strip()
    if _PHONE_LIKE.match(raw):
        digits = re.sub(r"\D", "", raw)
        return f"+{digits}" if raw.startswith("+") else digits
    return raw


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self._parent.setdefault(x, x)
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[ra] = rb


@dataclass
class _Group:
    identifiers: set[str] = field(default_factory=set)
    artifact_ids: set[str] = field(default_factory=set)
    channels: set[str] = field(default_factory=set)
    flagged: bool = False


def _channel_of(artifact: Artifact) -> str:
    """The demo's 'node has degree 4' is about distinct source
    files/platforms, not the internal `type` taxonomy -- WhatsApp and
    Instagram are both type="message" but are obviously different
    channels. Every image is its own file (img_0004.jpg, ...), so those
    get bucketed under one "images" channel rather than each counting
    separately."""
    return "images" if artifact.type == "image" else artifact.source


def _choose_label(identifiers: list[str]) -> str:
    non_phone = [i for i in identifiers if not i.startswith("+") and not i.isdigit()]
    pool = non_phone or identifiers
    return sorted(pool, key=len)[0]


def resolve_identities(artifacts: list[Artifact]) -> list[ResolvedActor]:
    uf = _UnionFind()

    # Pass 1: union identifiers that a message/image artifact
    # self-reports together.
    for artifact in artifacts:
        if artifact.type not in MERGE_ELIGIBLE_TYPES:
            continue
        mergeable = {
            normalize_identifier(i)
            for i in (
                artifact.entities.handles
                + artifact.entities.phones
                + artifact.entities.emails
            )
            if i
        }
        idents = list(mergeable)
        for i in range(1, len(idents)):
            uf.union(idents[0], idents[i])

    # Pass 2: attribute every artifact (all types) to whichever resolved
    # group its identifiers -- from actors OR entities -- belong to. This
    # is membership, not merging: an identifier that never appeared in a
    # merge-eligible artifact just resolves to its own singleton group.
    groups: dict[str, _Group] = {}

    for artifact in artifacts:
        touched = {
            normalize_identifier(i)
            for i in (
                artifact.actors
                + artifact.entities.handles
                + artifact.entities.phones
                + artifact.entities.emails
            )
            if i
        }
        for ident in touched:
            root = uf.find(ident)
            group = groups.setdefault(root, _Group())
            group.identifiers.add(ident)
            group.artifact_ids.add(artifact.artifact_id)
            group.channels.add(_channel_of(artifact))
            if artifact.flags:
                group.flagged = True

    resolved: list[ResolvedActor] = []
    for i, group in enumerate(
        sorted(groups.values(), key=lambda g: len(g.artifact_ids), reverse=True), start=1
    ):
        identifiers = sorted(group.identifiers)
        resolved.append(
            ResolvedActor(
                actor_id=f"actor_{i:04d}",
                label=_choose_label(identifiers),
                identifiers=identifiers,
                artifact_ids=sorted(group.artifact_ids),
                channels=sorted(group.channels),
                flagged=group.flagged,
            )
        )

    return resolved

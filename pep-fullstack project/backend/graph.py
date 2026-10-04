"""Entity graph -- ACPIA_Plan.md stack: networkx server-side, D3-force
client-side.

Nodes are resolved actors (identity.py). An edge exists between two
actors when some artifact's actor set includes both of them -- direct
co-occurrence, not inference. Edge weight rewards channel diversity over
raw count: a relationship that crosses from chat into a phone call is
the pattern investigators circle on paper; 50 messages on one platform
alone is just a chatty contact.

Beyond the base topology this module also computes what the graph view
needs to render risk, time, and structure without the frontend
re-deriving them from raw artifacts:
  - per-node hourly activity (for the time-of-day ring) and late-night %
  - per-edge first/last-seen (for temporal playback) and a channel
    breakdown (for platform-split parallel edges)
  - articulation points (for "bridge node" highlighting) -- a node whose
    removal disconnects the graph is structurally the single thread
    tying two otherwise-separate groups together, which is exactly what
    "one predator, four targets" looks like as topology.
"""

from __future__ import annotations

import re
from datetime import datetime
from itertools import combinations

import networkx as nx

from models import Artifact, ResolvedActor

_PHONE_RE = re.compile(r"^\+?\d{7,}$")
_HANDLE_RE = re.compile(r"^[a-z0-9._]+$")

LATE_NIGHT_HOURS = {22, 23, 0, 1, 2}


def _channel_of(artifact: Artifact) -> str:
    return "images" if artifact.type == "image" else artifact.source


def classify_actor(actor: ResolvedActor) -> str:
    """Node "kind" drives which icon the frontend renders -- the whole
    point of a legible graph is telling a phone number, a group chat, and
    a resolved person apart at a glance instead of reading every label."""
    if "group" in actor.label.lower():
        return "group"
    if all(_PHONE_RE.match(i) for i in actor.identifiers):
        return "phone"
    if any(
        _HANDLE_RE.match(i) and "_" in i and not _PHONE_RE.match(i) for i in actor.identifiers
    ):
        return "handle"
    return "person"


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def build_graph(
    artifacts: list[Artifact],
    identities: list[ResolvedActor],
    risk_scores: dict[str, float] | None = None,
) -> dict:
    risk_scores = risk_scores or {}
    ident_to_actor_id: dict[str, str] = {}
    for actor in identities:
        for ident in actor.identifiers:
            ident_to_actor_id[ident] = actor.actor_id

    g = nx.Graph()
    for actor in identities:
        g.add_node(actor.actor_id)

    for artifact in artifacts:
        idents = (
            artifact.actors
            + artifact.entities.handles
            + artifact.entities.phones
            + artifact.entities.emails
        )
        touched = {ident_to_actor_id[i] for i in idents if i in ident_to_actor_id}
        if len(touched) < 2:
            continue

        channel = _channel_of(artifact)
        when = artifact.time.value
        for a, b in combinations(sorted(touched), 2):
            if g.has_edge(a, b):
                data = g[a][b]
                data["artifact_count"] += 1
                data["channels"].add(channel)
                data["channel_counts"][channel] = data["channel_counts"].get(channel, 0) + 1
                if when < data["first_seen"]:
                    data["first_seen"] = when
                if when > data["last_seen"]:
                    data["last_seen"] = when
                if len(data["artifact_ids"]) < 10:  # cap payload size
                    data["artifact_ids"].append(artifact.artifact_id)
            else:
                g.add_edge(
                    a,
                    b,
                    artifact_count=1,
                    channels={channel},
                    channel_counts={channel: 1},
                    artifact_ids=[artifact.artifact_id],
                    first_seen=when,
                    last_seen=when,
                )

    # Articulation points: nodes whose removal splits the graph into more
    # components. Meaningless on a graph that's already in pieces or too
    # small to have real structure, so only compute past a trivial size.
    bridge_nodes: set[str] = set()
    if g.number_of_nodes() > 2:
        bridge_nodes = set(nx.articulation_points(g))

    time_by_artifact = {a.artifact_id: a.time.value for a in artifacts}

    # Per-actor hourly activity (0-23) and late-night share, over every
    # artifact where this actor appears -- not authored-only, so a node
    # they only ever *received* messages in still shows a time-of-day
    # pattern rather than an empty ring.
    hourly: dict[str, list[int]] = {actor.actor_id: [0] * 24 for actor in identities}
    late_night_count: dict[str, int] = {actor.actor_id: 0 for actor in identities}
    total_count: dict[str, int] = {actor.actor_id: 0 for actor in identities}

    for artifact in artifacts:
        idents = artifact.actors + artifact.entities.handles + artifact.entities.phones
        touched = {ident_to_actor_id[i] for i in idents if i in ident_to_actor_id}
        try:
            hour = _parse_time(artifact.time.value).hour
        except ValueError:
            continue
        for actor_id in touched:
            if actor_id not in hourly:
                continue
            hourly[actor_id][hour] += 1
            total_count[actor_id] += 1
            if hour in LATE_NIGHT_HOURS:
                late_night_count[actor_id] += 1

    def _peak_range(hours: list[int]) -> str | None:
        if sum(hours) == 0:
            return None
        peak_hour = max(range(24), key=lambda h: hours[h])
        end_hour = (peak_hour + 3) % 24
        return f"{peak_hour:02d}:00–{end_hour:02d}:00"

    nodes = [
        {
            "actor_id": actor.actor_id,
            "label": actor.label,
            "kind": classify_actor(actor),
            "degree": len(actor.channels),
            "flagged": actor.flagged,
            "channels": actor.channels,
            "artifact_count": len(actor.artifact_ids),
            "first_seen": min(
                (time_by_artifact[aid] for aid in actor.artifact_ids if aid in time_by_artifact),
                default=None,
            ),
            "last_seen": max(
                (time_by_artifact[aid] for aid in actor.artifact_ids if aid in time_by_artifact),
                default=None,
            ),
            "risk_score": round(risk_scores.get(actor.actor_id, 0.0), 3),
            "hourly_activity": hourly.get(actor.actor_id, [0] * 24),
            "late_night_pct": round(
                (late_night_count.get(actor.actor_id, 0) / total_count[actor.actor_id] * 100)
                if total_count.get(actor.actor_id)
                else 0.0,
                1,
            ),
            "peak_hours": _peak_range(hourly.get(actor.actor_id, [0] * 24)),
            "bridge": actor.actor_id in bridge_nodes,
        }
        for actor in identities
    ]

    edges = [
        {
            "source": a,
            "target": b,
            "artifact_count": data["artifact_count"],
            "channels": sorted(data["channels"]),
            "channel_counts": data["channel_counts"],
            "artifact_ids": data["artifact_ids"],
            "weight": data["artifact_count"] * (1.0 + 0.5 * (len(data["channels"]) - 1)),
            "first_seen": data["first_seen"],
            "last_seen": data["last_seen"],
        }
        for a, b, data in g.edges(data=True)
    ]

    return {"nodes": nodes, "edges": edges}

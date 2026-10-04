"""Shared Pydantic models. `Artifact` and friends mirror the canonical
schema in ACPIA_Plan.md section 1 exactly — every parser in parsers.py
produces this shape and nothing downstream needs to know which source
file an artifact came from."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ArtifactType = Literal["message", "call", "browser_history", "image"]
TimeKind = Literal["authored", "logged", "captured"]
CaseStatus = Literal["open", "under_review", "closed"]


class TimeInfo(BaseModel):
    value: str  # ISO 8601, UTC
    kind: TimeKind
    source_field: str
    tz_inferred: bool
    confidence: float


class Entities(BaseModel):
    handles: list[str] = []
    phones: list[str] = []
    emails: list[str] = []
    device_ids: list[str] = []
    geo: str | None = None


class Artifact(BaseModel):
    artifact_id: str
    type: ArtifactType
    source: str
    time: TimeInfo
    actors: list[str]
    entities: Entities
    content_ref: str
    flags: list[str] = []


class CaseCreate(BaseModel):
    title: str
    fir_number: str | None = None
    station: str | None = None
    investigating_officer: str | None = None
    notes: str | None = None


class Case(BaseModel):
    case_id: str
    title: str
    fir_number: str | None = None
    station: str | None = None
    investigating_officer: str | None = None
    notes: str | None = None
    status: CaseStatus = "open"
    created_at: str
    artifact_count: int = 0
    flagged_count: int = 0


class IngestResult(BaseModel):
    artifact_count: int
    flagged_count: int
    sources: list[str]
    skipped: list[str] = []


class ResolvedActor(BaseModel):
    """A union-find group: one or more raw identifiers judged to be the
    same real-world actor because they co-occurred inside a message or
    image artifact's entities (see identity.py for exactly what counts)."""

    actor_id: str
    label: str
    identifiers: list[str]
    artifact_ids: list[str]
    channels: list[str]  # distinct source files/platforms -- graph node "degree"
    flagged: bool


class ArtifactAnnotation(BaseModel):
    """Investigator-added, not system-derived -- distinct from the
    automated `flags` on Artifact (hash matches). A tag here means a
    human reviewed this artifact and marked it, which is why tags render
    in red (high-risk, confirmed) while automated flags stay amber
    (pending review) per the design spec."""

    tags: list[str] = []
    notes: str = ""


class LeadDecision(BaseModel):
    """An investigator's ruling on a triage lead. The plan's non-negotiable
    #4: confirm/reject on every lead, because "maintaining appropriate
    human oversight" has to be a control in the product, not a claim in
    the pitch. `note` records why — a rejected lead with a reason is
    training data for the next iteration of the rules."""

    decision: Literal["confirmed", "rejected", "flagged"]
    note: str = ""


class TagPayload(BaseModel):
    tag: str


class NotesPayload(BaseModel):
    text: str

"""In-memory artifact store: a dict of case_id -> CaseStore, each holding
a list plus a content dict. No database — see ACPIA_Plan.md section 3.

`content` holds whatever raw/structured payload an artifact points at via
`content_ref` (message text, a call's raw row, an image's metadata — never
raw image bytes; see parsers.py for why). Kept separate from the artifact
list itself so the canonical schema stays lean."""

from __future__ import annotations

from typing import Any

from models import Artifact, ArtifactAnnotation, LeadDecision


class CaseStore:
    def __init__(self) -> None:
        self.artifacts: list[Artifact] = []
        self.content: dict[str, Any] = {}
        self.annotations: dict[str, ArtifactAnnotation] = {}
        # Investigator rulings on triage leads, keyed by the lead's index
        # in the cached triage result.
        self.lead_decisions: dict[int, LeadDecision] = {}
        # Alerts an officer has explicitly acknowledged, by alert_id.
        # Acknowledgement is recorded because it actually happened —
        # unlike "unread", which would need a record of when the officer
        # last looked, and this build keeps no such log.
        self.alert_acks: set[str] = set()
        self._next_id = 1

    def next_artifact_id(self) -> str:
        artifact_id = f"a_{self._next_id:04d}"
        self._next_id += 1
        return artifact_id

    def add(self, artifact: Artifact, content: Any) -> None:
        self.artifacts.append(artifact)
        self.content[artifact.content_ref] = content

    @property
    def count(self) -> int:
        return len(self.artifacts)

    @property
    def flagged_count(self) -> int:
        return sum(1 for a in self.artifacts if a.flags)


_stores: dict[str, CaseStore] = {}


def get_store(case_id: str) -> CaseStore:
    if case_id not in _stores:
        _stores[case_id] = CaseStore()
    return _stores[case_id]


def drop_store(case_id: str) -> None:
    _stores.pop(case_id, None)


def has_store(case_id: str) -> bool:
    """Unlike get_store, doesn't create one as a side effect — so callers
    aggregating across cases can't accidentally populate the dict."""
    return case_id in _stores

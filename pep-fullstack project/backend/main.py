"""ACPIA backend — FastAPI service.

An investigation starts with a case (FIR), not a file drop. Evidence is
ingested *into* a case, parsed into the canonical artifact schema
(models.py), and held in an in-memory per-case store (store.py) — no
database, per ACPIA_Plan.md section 3.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import alerts as alerts_module
import audit
import correlation
import graph as graph_module
import parsers
import report as report_module
import search as search_module
import settings as settings_module
import evidence_stats as evidence_stats_module
import ml_service
import signals
import stages as stages_module
import stats
import triage as triage_module
from identity import resolve_identities
from models import (
    Artifact,
    ArtifactAnnotation,
    Case,
    CaseCreate,
    IngestResult,
    LeadDecision,
    NotesPayload,
    ResolvedActor,
    TagPayload,
)
from store import get_store

def _load_env_file() -> None:
    """Read backend/.env into the environment (ANTHROPIC_API_KEY lives
    there). Hand-rolled rather than pulling in python-dotenv: it's twelve
    lines, and one less thing to `pip install` on a strange machine the
    morning of the pitch. Existing environment variables always win, so
    an exported key overrides the file."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file()

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Runs once, after the module has fully loaded, so this can call
    # _seed_demo_case even though that function is defined further down
    # the file -- Python resolves the name at call time, not here.
    _seed_demo_case()
    yield


app = FastAPI(title="ACPIA Backend", version="0.1.0", lifespan=lifespan)

# Next.js dev server proxies through here; keep CORS open in dev only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trained PAN12 models: /ml/* (metrics, datasets) and /cases/{id}/ml (case analysis).
app.include_router(ml_service.router)

# In-memory store — a dict, no database. See ACPIA_Plan.md section 3.
_cases: dict[str, Case] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cases", response_model=Case)
def create_case(payload: CaseCreate) -> Case:
    case_id = f"case_{uuid.uuid4().hex[:8]}"
    case = Case(
        case_id=case_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        **payload.model_dump(),
    )
    _cases[case_id] = case
    audit.record(
        case_id,
        "case_created",
        f"Case opened: {case.title}",
        actor=case.investigating_officer,
        detail={"fir_number": case.fir_number, "station": case.station},
    )
    return case


@app.get("/cases", response_model=list[Case])
def list_cases() -> list[Case]:
    return sorted(_cases.values(), key=lambda c: c.created_at, reverse=True)


@app.get("/stats")
def get_stats() -> dict:
    """Cross-case aggregates for the dashboard. Declared before
    /cases/{case_id} would be ambiguous, but it's a separate path so
    ordering doesn't matter — kept here for readability."""
    return stats.build_stats(list(_cases.values()))


@app.get("/settings")
def get_settings() -> dict:
    """Effective runtime configuration — see settings.py. Global, not
    case-scoped: this is how the engine is set up, not anything about one
    case. Read-only, and never returns a secret."""
    return settings_module.build_settings()


@app.get("/cases/{case_id}", response_model=Case)
def get_case(case_id: str) -> Case:
    case = _cases.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _require_case(case_id: str) -> Case:
    case = _cases.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _officer(case_id: str) -> str | None:
    """Best available attribution for an audit entry. There is no user
    model in this build, so this is the officer the case names — which is
    free text, and is not the same thing as knowing who clicked. The log
    falls back to "unattributed" rather than guessing."""
    case = _cases.get(case_id)
    return case.investigating_officer if case else None


@app.get("/cases/{case_id}/artifacts", response_model=list[Artifact])
def get_artifacts(case_id: str) -> list[Artifact]:
    _require_case(case_id)
    store = get_store(case_id)
    return sorted(store.artifacts, key=lambda a: a.time.value)


@app.get("/cases/{case_id}/identities", response_model=list[ResolvedActor])
def get_identities(case_id: str) -> list[ResolvedActor]:
    _require_case(case_id)
    store = get_store(case_id)
    return resolve_identities(store.artifacts)


@app.get("/cases/{case_id}/content")
def get_content(case_id: str) -> dict:
    """Bulk content_ref -> content payload (message text, call info,
    browser row, image metadata -- never raw image bytes). Returned in
    one shot rather than per-artifact: at case scale (hundreds, not
    millions, of artifacts) one round trip beats N+1 lazy fetches for a
    timeline that wants to show every row's content at once."""
    _require_case(case_id)
    store = get_store(case_id)
    return store.content


@app.get("/cases/{case_id}/graph")
def get_graph(case_id: str) -> dict:
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    profiles = signals.build_profiles(store.artifacts, store.content, identities)
    risk_scores = {p.actor_id: p.risk_score for p in profiles}
    return graph_module.build_graph(store.artifacts, identities, risk_scores)


@app.get("/cases/{case_id}/correlations")
def get_correlations(case_id: str) -> dict:
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    linked = correlation.compute_linked_artifacts(store.artifacts, identities)
    return {
        artifact_id: [{"artifact_id": c.artifact_id, "score": round(c.score, 3)} for c in cs]
        for artifact_id, cs in linked.items()
    }


@app.get("/cases/{case_id}/signals")
def get_signals(case_id: str) -> list[dict]:
    """Deterministic grooming-signal profiles per resolved actor. Exposed
    separately from triage so the lexicon/arithmetic layer is inspectable
    on its own — an officer can see the counts without an agent involved."""
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    profiles = signals.build_profiles(store.artifacts, store.content, identities)
    return [p.to_dict() for p in profiles]


@app.get("/cases/{case_id}/stages")
def get_stages(case_id: str, actor1: str = "", actor2: str = "") -> list[dict]:
    """Grooming-stage breakdown for a relationship between two actors."""
    _require_case(case_id)
    store = get_store(case_id)
    if not actor1 or not actor2:
        return []
    identities = resolve_identities(store.artifacts)
    blocks = stages_module.classify_stages(
        store.artifacts, store.content, actor1, actor2, identities,
    )
    return [b.to_dict() for b in blocks]


@app.get("/cases/{case_id}/stages/summary")
def get_stage_summary(
    case_id: str, actor1: str = "", actor2: str = "", stage: str = "",
) -> dict:
    """Summary for one grooming stage between two actors."""
    _require_case(case_id)
    store = get_store(case_id)
    if not actor1 or not actor2 or not stage:
        return {"error": "actor1, actor2, and stage are required"}
    identities = resolve_identities(store.artifacts)
    return stages_module.get_stage_summary(
        store.artifacts, store.content, actor1, actor2, stage, identities,
    )


@app.get("/cases/{case_id}/evidence-stats")
def get_evidence_stats(case_id: str) -> dict:
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    return evidence_stats_module.build_evidence_stats(
        store.artifacts, store.content, identities,
    )


@app.get("/cases/{case_id}/search")
def search_case(
    case_id: str,
    q: str = "",
    types: str = "",
    flagged_only: bool = False,
    limit: int = 50,
) -> dict:
    """Full-text search across every text-bearing field the parsers
    produce — see search.py for what that covers and how it ranks.

    Server-side rather than filtering the artifacts the timeline already
    fetched: the client only holds one case's artifacts once it has
    loaded them, and the response carries the matched field and highlight
    offsets so the UI never has to re-run the match and risk showing
    something different from what was scored.
    """
    _require_case(case_id)
    store = get_store(case_id)
    selected = {t.strip() for t in types.split(",") if t.strip()}
    return search_module.search_artifacts(
        store.artifacts,
        store.content,
        q,
        types=selected or None,
        flagged_only=flagged_only,
        limit=limit,
    )


@app.post("/cases/{case_id}/triage")
def run_triage(case_id: str, refresh: bool = False) -> dict:
    """Agentic triage — the tool-use loop, the citation guard, and the
    rule-based fallback (ACPIA_Plan.md sections 5 and 7).

    POST rather than GET because the first call for a case has a real
    side effect: it spends an agent run and caches the result. `refresh`
    forces a re-run.
    """
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    ctx = triage_module.build_context(
        store.artifacts,
        store.content,
        identities,
        graph_module.build_graph(store.artifacts, identities),
    )
    # Whether this call actually ran the agent or served the cache is the
    # interesting part of the entry: a run costs a model call and can
    # produce different leads, a cache hit cannot.
    was_cached = triage_module.get_cached(case_id) is not None and not refresh
    result = triage_module.run_triage(case_id, ctx, refresh=refresh)
    if not was_cached:
        audit.record(
            case_id,
            "triage_run",
            (
                f"Triage produced {len(result.leads)} lead(s) via "
                f"{'agentic triage' if result.source == 'agent' else 'rule-based triage'}"
                + (f" ({result.model})" if result.model else "")
            ),
            actor=_officer(case_id),
            detail={
                "source": result.source,
                "model": result.model,
                "leads": len(result.leads),
                "dropped_by_citation_guard": len(result.dropped),
                "refresh": refresh,
            },
        )
    return result.to_dict()


@app.get("/cases/{case_id}/alerts")
def get_alerts(case_id: str) -> dict:
    """Deterministic alert rules over the evidence — see alerts.py.

    Recomputed per request rather than stored: the rules are cheap, and a
    stored alert list would go stale against the evidence the moment
    anything was ingested. Acknowledgement is the only piece of state,
    and it's keyed by a stable alert_id so it survives recomputation.
    """
    _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    profiles = signals.build_profiles(store.artifacts, store.content, identities)
    correlations = correlation.compute_linked_artifacts(store.artifacts, identities)
    return alerts_module.build_alerts(
        artifacts=store.artifacts,
        identities=identities,
        profiles=profiles,
        correlations=correlations,
        acknowledged=store.alert_acks,
    )


@app.post("/cases/{case_id}/alerts/{alert_id}/ack")
def acknowledge_alert(case_id: str, alert_id: str, acknowledged: bool = True) -> dict:
    """Mark an alert acknowledged, or clear it again."""
    _require_case(case_id)
    store = get_store(case_id)
    changed = (alert_id in store.alert_acks) != acknowledged
    if acknowledged:
        store.alert_acks.add(alert_id)
    else:
        store.alert_acks.discard(alert_id)
    if changed:
        audit.record(
            case_id,
            "alert_acknowledged" if acknowledged else "alert_reopened",
            f"{'Acknowledged' if acknowledged else 'Reopened'} alert {alert_id}",
            actor=_officer(case_id),
            detail={"alert_id": alert_id},
        )
    return {"alert_id": alert_id, "acknowledged": acknowledged}


@app.get("/cases/{case_id}/audit")
def get_audit_log(case_id: str, category: str = "", limit: int = 200) -> dict:
    """The case's audit trail, newest first — see audit.py.

    Append-only: there is no route that edits or deletes an entry, which
    is the only property that makes a log like this worth having.
    """
    _require_case(case_id)
    return audit.for_case(case_id, category=category.strip() or None, limit=limit)


@app.get("/cases/{case_id}/report")
def get_report(case_id: str) -> dict:
    """Assemble the case report — see report.py.

    Read-only and side-effect free. In particular it reads the *cached*
    triage result rather than running triage: a report is a record of
    what an officer reviewed, and opening one must never kick off a fresh
    agent run whose findings nobody has seen.
    """
    case = _require_case(case_id)
    store = get_store(case_id)
    identities = resolve_identities(store.artifacts)
    profiles = signals.build_profiles(store.artifacts, store.content, identities)
    return report_module.build_report(
        case=case,
        artifacts=store.artifacts,
        identities=identities,
        profiles=profiles,
        annotations=store.annotations,
        decisions=store.lead_decisions,
        triage_result=triage_module.get_cached(case_id),
    )


@app.post("/cases/{case_id}/report/exported")
def record_report_export(case_id: str, format: str = "markdown") -> dict:
    """Record that a report left the application — copied or downloaded.

    Opening a report is a *read* and isn't logged; the view fetches on
    every mount, so logging that would bury the entries that matter under
    navigation noise. An export is different: it's the moment case
    material leaves the console, which is exactly what an audit log is
    for.
    """
    _require_case(case_id)
    audit.record(
        case_id,
        "report_generated",
        f"Case report exported ({format})",
        actor=_officer(case_id),
        detail={"format": format},
    )
    return {"recorded": True}


@app.post("/cases/{case_id}/leads/{lead_index}/decision", response_model=LeadDecision)
def set_lead_decision(case_id: str, lead_index: int, payload: LeadDecision) -> LeadDecision:
    """Confirm / reject / flag on a lead — the human-oversight control the
    brief asks for. Stored per case; the lead index is the position in the
    cached triage result, which is stable until someone forces a refresh."""
    _require_case(case_id)
    store = get_store(case_id)
    store.lead_decisions[lead_index] = payload

    cached = triage_module.get_cached(case_id)
    title = (
        cached.leads[lead_index].title
        if cached and 0 <= lead_index < len(cached.leads)
        else f"lead {lead_index}"
    )
    audit.record(
        case_id,
        "lead_decision",
        f"Lead {payload.decision}: {title}",
        actor=_officer(case_id),
        detail={"lead_index": lead_index, "decision": payload.decision},
        artifact_ids=(
            cached.leads[lead_index].evidence
            if cached and 0 <= lead_index < len(cached.leads)
            else []
        ),
    )
    return payload


@app.get("/cases/{case_id}/leads/decisions")
def get_lead_decisions(case_id: str) -> dict[int, LeadDecision]:
    _require_case(case_id)
    return get_store(case_id).lead_decisions


@app.get("/cases/{case_id}/annotations")
def get_annotations(case_id: str) -> dict[str, ArtifactAnnotation]:
    _require_case(case_id)
    return get_store(case_id).annotations


@app.post("/cases/{case_id}/artifacts/{artifact_id}/tags", response_model=ArtifactAnnotation)
def add_tag(case_id: str, artifact_id: str, payload: TagPayload) -> ArtifactAnnotation:
    _require_case(case_id)
    store = get_store(case_id)
    ann = store.annotations.setdefault(artifact_id, ArtifactAnnotation())
    tag = payload.tag.strip()
    if tag and tag not in ann.tags:
        ann.tags.append(tag)
        audit.record(
            case_id,
            "tag_added",
            f"Tagged {artifact_id} “{tag}”",
            actor=_officer(case_id),
            artifact_ids=[artifact_id],
            detail={"tag": tag},
        )
    return ann


@app.delete("/cases/{case_id}/artifacts/{artifact_id}/tags/{tag}", response_model=ArtifactAnnotation)
def remove_tag(case_id: str, artifact_id: str, tag: str) -> ArtifactAnnotation:
    _require_case(case_id)
    store = get_store(case_id)
    ann = store.annotations.setdefault(artifact_id, ArtifactAnnotation())
    if tag in ann.tags:
        ann.tags = [t for t in ann.tags if t != tag]
        audit.record(
            case_id,
            "tag_removed",
            f"Removed tag “{tag}” from {artifact_id}",
            actor=_officer(case_id),
            artifact_ids=[artifact_id],
            detail={"tag": tag},
        )
    return ann


@app.put("/cases/{case_id}/artifacts/{artifact_id}/notes", response_model=ArtifactAnnotation)
def set_notes(case_id: str, artifact_id: str, payload: NotesPayload) -> ArtifactAnnotation:
    _require_case(case_id)
    store = get_store(case_id)
    ann = store.annotations.setdefault(artifact_id, ArtifactAnnotation())
    changed = ann.notes != payload.text
    ann.notes = payload.text
    if changed:
        # The note's text is recorded in the case, not in the log line —
        # an audit entry says an action happened, it isn't a second copy
        # of the investigator's working notes.
        audit.record(
            case_id,
            "notes_saved",
            f"{'Cleared' if not payload.text.strip() else 'Saved'} notes on {artifact_id}",
            actor=_officer(case_id),
            artifact_ids=[artifact_id],
            detail={"characters": len(payload.text)},
        )
    return ann


# File-routing table: matched against the lowercased basename first (exact
# filenames from generate_case.py), falling back to extension for images
# so a folder drop's images/ subdirectory works regardless of how deep
# the browser reports its relative path.
_EXACT_HANDLERS = {
    "whatsapp_export.txt": "whatsapp",
    "instagram_dm.json": "instagram",
    "call_log.csv": "call_log",
    "browser_history.csv": "browser_history",
}
_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")


def _ingest_raw_files(case: Case, raw_files: list[tuple[str, bytes]]) -> IngestResult:
    """The actual parsing/routing logic, shared by the HTTP endpoint and
    the startup auto-seed (_seed_demo_case) so there is exactly one place
    that decides how a filename maps to a parser. raw_files is
    (name, content) pairs, already read into memory — the HTTP endpoint
    reads them off the upload, the seeder reads them off disk."""
    store = get_store(case.case_id)

    # Two buckets in one bag: sha256 for byte-identical matches, phash for
    # perceptual near-duplicates. Merging preserves both across multiple
    # known_hashes.txt files (rare, but a case with attachments from two
    # forces would have two known lists).
    known = parsers.KnownHashes.empty()
    for name, content in raw_files:
        if name.rsplit("/", 1)[-1].lower() == "known_hashes.txt":
            known = known.merge(parsers.parse_known_hashes(content.decode("utf-8")))

    sources: list[str] = []
    skipped: list[str] = []

    for name, content in raw_files:
        basename = name.rsplit("/", 1)[-1]
        key = basename.lower()

        if key == "known_hashes.txt":
            sources.append(name)
            continue

        if key in _EXACT_HANDLERS:
            handler = _EXACT_HANDLERS[key]
            text = content.decode("utf-8")
            if handler == "whatsapp":
                parsers.parse_whatsapp(text, name, store)
            elif handler == "instagram":
                parsers.parse_instagram(text, name, store)
            elif handler == "call_log":
                parsers.parse_call_log(text, name, store)
            elif handler == "browser_history":
                parsers.parse_browser_history(text, name, store)
            sources.append(name)
        elif key.endswith(_IMAGE_EXTENSIONS):
            parsers.parse_image(content, name, known, store)
            sources.append(name)
        else:
            skipped.append(name)

    case.artifact_count = store.count
    case.flagged_count = store.flagged_count

    audit.record(
        case.case_id,
        "evidence_ingested",
        (
            f"Ingested {len(sources)} file(s) — {store.count} artifacts parsed, "
            f"{store.flagged_count} flagged"
        ),
        actor=case.investigating_officer,
        detail={
            "files": len(sources),
            "artifacts_total": store.count,
            "flagged_total": store.flagged_count,
            "skipped": len(skipped),
        },
    )

    return IngestResult(
        artifact_count=store.count,
        flagged_count=store.flagged_count,
        sources=sources,
        skipped=skipped,
    )


@app.post("/cases/{case_id}/ingest", response_model=IngestResult)
async def ingest(case_id: str, files: list[UploadFile]) -> IngestResult:
    case = _cases.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    # Read everything up front so file order in the multipart payload
    # (which a browser folder-drop does not guarantee) can't matter.
    raw_files: list[tuple[str, bytes]] = []
    for f in files:
        raw_files.append((f.filename or "unknown", await f.read()))

    return _ingest_raw_files(case, raw_files)


DEMO_CASE_BUNDLE = Path(__file__).parent.parent / "data" / "case_bundle"
_DEMO_BUNDLE_FILES = (
    "whatsapp_export.txt",
    "instagram_dm.json",
    "call_log.csv",
    "browser_history.csv",
    "known_hashes.txt",
)


def _seed_demo_case() -> None:
    """Auto-seed the canonical demo case on startup.

    There is no database (ACPIA_Plan.md section 3), so every case and
    artifact lives only in this process's RAM -- a crash, a reboot, or
    the Windows ghost-socket issue this project has already hit more
    than once wipes it. The plan itself calls for exactly this ("seed
    the exact demo state," "cache the agent response... so if the
    network dies, the demo still runs"); this closes the gap between
    that goal and what actually happens on an unplanned restart, so the
    dashboard is never the thing that's empty when someone glances at it
    before a pitch.

    Deliberately conservative about when it acts: skips quietly (never
    raises -- a seeding failure must not take the app down) if a case
    already exists, if ACPIA_SKIP_SEED is set, or if the bundle isn't on
    disk yet (e.g. generate_case.py hasn't been run on a fresh clone)."""
    if _cases or os.environ.get("ACPIA_SKIP_SEED"):
        return
    if not DEMO_CASE_BUNDLE.is_dir():
        print(f"[seed] no bundle at {DEMO_CASE_BUNDLE}, skipping auto-seed")
        return

    try:
        raw_files: list[tuple[str, bytes]] = []
        for name in _DEMO_BUNDLE_FILES:
            path = DEMO_CASE_BUNDLE / name
            if path.exists():
                raw_files.append((name, path.read_bytes()))

        images_dir = DEMO_CASE_BUNDLE / "images"
        if images_dir.is_dir():
            for image_path in sorted(images_dir.iterdir()):
                raw_files.append((f"images/{image_path.name}", image_path.read_bytes()))

        if not raw_files:
            print(f"[seed] bundle at {DEMO_CASE_BUNDLE} is empty, skipping auto-seed")
            return

        case = Case(
            case_id=f"case_{uuid.uuid4().hex[:8]}",
            title="Op Riverbank",
            fir_number="FIR/2026/0114",
            station="Cyberdome HQ",
            investigating_officer="Inspector R. Kumar",
            notes="Auto-seeded on startup from data/case_bundle (backend/main.py: _seed_demo_case).",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        _cases[case.case_id] = case
        result = _ingest_raw_files(case, raw_files)
        print(
            f"[seed] demo case {case.case_id} ready: "
            f"{result.artifact_count} artifacts, {result.flagged_count} flagged"
        )
    except Exception as exc:  # startup seeding must never crash the app
        print(f"[seed] failed to auto-seed demo case: {exc}")

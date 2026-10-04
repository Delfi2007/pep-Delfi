"""Case report generation — the plan's "automated case-report generation
from confirmed leads".

The whole value of this file is that it invents nothing. Every number is
counted from the artifact store, every finding is a lead an officer
explicitly confirmed, and every finding keeps the artifact IDs the triage
engine cited. If there is nothing to report, it says so rather than
padding.

Four rules that shape the output:

1. **Only confirmed leads become findings.** A lead the officer rejected
   is excluded and counted as excluded; a lead nobody has ruled on is
   listed as outstanding, not quietly promoted. The report states the
   review position honestly, which is the only version of this document
   that would survive contact with a defence lawyer.

2. **Generating a report never runs the agent.** It reads the cached
   triage result (`triage.get_cached`) — a report is a record of what was
   reviewed, and a document that started a fresh model run each time it
   was opened would describe findings nobody had seen.

3. **Timestamp caveats travel with the report.** WhatsApp exports and
   EXIF carry no timezone, so those times are inferred. The count of
   inferred timestamps goes in the limitations section rather than being
   silently presented as recorded fact.

4. **Markdown is rendered here, not in the browser.** The exported file
   and the on-screen report come from one function, so they cannot drift.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from identity import _channel_of
from models import Artifact, ArtifactAnnotation, Case, LeadDecision, ResolvedActor
from signals import CONCERN_THRESHOLD, ActorSignalProfile

TYPE_LABELS: dict[str, str] = {
    "message": "Messages",
    "call": "Call log entries",
    "browser_history": "Browser history rows",
    "image": "Images",
}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _evidence_summary(artifacts: list[Artifact]) -> dict[str, Any]:
    by_type: dict[str, int] = {}
    sources: dict[str, int] = {}
    tz_inferred = 0
    times: list[str] = []

    for artifact in artifacts:
        by_type[artifact.type] = by_type.get(artifact.type, 0) + 1
        # Grouped by channel, not by raw `source`: every image is its own
        # file, so keying on source lists 45 filenames where a reader
        # expects "images". `_channel_of` is the same rule identity.py
        # uses for an actor's channel span — one definition of "which
        # channel is this", not two that could drift.
        sources[_channel_of(artifact)] = sources.get(_channel_of(artifact), 0) + 1
        if artifact.time.tz_inferred:
            tz_inferred += 1
        times.append(artifact.time.value)

    flagged = [a for a in artifacts if a.flags]

    return {
        "total": len(artifacts),
        "flagged": len(flagged),
        "flagged_artifacts": [
            {
                "artifact_id": a.artifact_id,
                "type": a.type,
                "source": a.source,
                "time": a.time.value,
                "flags": a.flags,
            }
            for a in sorted(flagged, key=lambda a: a.time.value)
        ],
        "by_type": [
            {"type": t, "label": TYPE_LABELS.get(t, t), "count": c}
            for t, c in sorted(by_type.items(), key=lambda kv: -kv[1])
        ],
        "sources": [
            {"source": s, "count": c}
            for s, c in sorted(sources.items(), key=lambda kv: -kv[1])
        ],
        "tz_inferred": tz_inferred,
        "first_event": min(times) if times else None,
        "last_event": max(times) if times else None,
    }


def _identity_summary(identities: list[ResolvedActor]) -> dict[str, Any]:
    # The cross-channel resolutions are the ones worth naming in a report:
    # an actor holding one identifier on one platform is unremarkable, an
    # actor resolved across several is a finding about the case.
    cross_channel = [
        {
            "label": a.label,
            "identifiers": a.identifiers,
            "channels": a.channels,
            "artifact_count": len(a.artifact_ids),
        }
        for a in identities
        if len(a.channels) > 1 or len(a.identifiers) > 1
    ]
    cross_channel.sort(key=lambda a: len(a["channels"]), reverse=True)
    return {"resolved_actors": len(identities), "cross_channel": cross_channel}


def _persons_of_interest(profiles: list[ActorSignalProfile]) -> list[dict[str, Any]]:
    return [
        {
            "label": p.label,
            "identifiers": p.identifiers,
            "channels": p.channels,
            "risk_score": round(p.risk_score, 3),
            "messages_authored": p.messages_authored,
            "counterparties": p.counterparties,
            "signal_counts": p.signal_counts,
            # Two per signal is enough to support the line in a report;
            # the full set stays available in the Persons of interest view.
            "evidence": list(
                dict.fromkeys(
                    e for ids in p.signal_evidence.values() for e in ids[:2]
                )
            )[:8],
            "late_night_ratio": round(p.late_night_ratio, 3),
            "escalation_slope": round(p.escalation_slope, 3),
        }
        for p in profiles
        if p.risk_score >= CONCERN_THRESHOLD
    ]


def _findings(
    triage_result: Any | None, decisions: dict[int, LeadDecision]
) -> dict[str, Any]:
    """Confirmed leads become findings; everything else is accounted for
    rather than dropped."""
    if triage_result is None:
        return {
            "triage_run": False,
            "source": None,
            "model": "",
            "confirmed": [],
            "flagged_for_review": [],
            "rejected_count": 0,
            "undecided_count": 0,
        }

    confirmed: list[dict[str, Any]] = []
    flagged_for_review: list[dict[str, Any]] = []
    rejected = 0
    undecided = 0

    for index, lead in enumerate(triage_result.leads):
        decision = decisions.get(index)
        entry = {
            "title": lead.title,
            "priority": lead.priority,
            "summary": lead.summary,
            "evidence": lead.evidence,
            "actors": lead.actors,
            "recommended_action": lead.recommended_action,
            "note": decision.note if decision else "",
        }
        if decision is None:
            undecided += 1
        elif decision.decision == "confirmed":
            confirmed.append(entry)
        elif decision.decision == "flagged":
            flagged_for_review.append(entry)
        else:
            rejected += 1

    return {
        "triage_run": True,
        "source": triage_result.source,
        "model": triage_result.model,
        "confirmed": confirmed,
        "flagged_for_review": flagged_for_review,
        "rejected_count": rejected,
        "undecided_count": undecided,
    }


def _annotation_summary(
    annotations: dict[str, ArtifactAnnotation],
) -> dict[str, Any]:
    items = [
        {
            "artifact_id": artifact_id,
            "tags": ann.tags,
            "notes": ann.notes,
        }
        for artifact_id, ann in sorted(annotations.items())
        if ann.tags or (ann.notes or "").strip()
    ]
    return {
        "count": len(items),
        "items": items,
    }


def _method_notes(evidence: dict[str, Any], findings: dict[str, Any]) -> list[str]:
    """The limitations section, as data rather than prose baked into the
    Markdown renderer — the report view shows the same list, so the
    screen and the exported file state the same caveats. These are
    substantive claims about what the system did and didn't do; they are
    not UI copy and must not be paraphrased in one place and not the
    other."""
    notes = [
        "Evidence was parsed into a single canonical artifact schema; counts above "
        "are of parsed artifacts, not of source files.",
        "Identity resolution merges identifiers only where an actor self-reports one "
        "in a message or image — a call's caller/callee never licenses a merge.",
    ]
    if evidence["tz_inferred"]:
        notes.append(
            f"{evidence['tz_inferred']} of {evidence['total']} timestamps have an "
            "inferred timezone. WhatsApp exports and EXIF carry no timezone, so those "
            "times are normalised to UTC on the assumption of local time and should "
            "not be treated as recorded to the minute."
        )
    notes.append(
        "Image flagging is exact SHA-256 matching against a known-hash list. "
        "Perceptual (pHash) matching is not implemented, so a re-encoded or resized "
        "copy of a known image would not be flagged."
    )
    notes.append(
        "Signal scoring is lexical and structural, not semantic. It identifies "
        "patterns for an officer to review; it makes no determination."
    )
    if findings["triage_run"] and findings["source"] == "agent":
        notes.append(
            "Agent-produced leads passed a citation guard: any lead citing an "
            "artifact ID absent from this case's store was discarded before review."
        )
    notes.append(
        "This build holds evidence in memory only and keeps no audit log, so this "
        "report reflects the state of the case at the moment it was generated."
    )
    return notes


def build_report(
    case: Case,
    artifacts: list[Artifact],
    identities: list[ResolvedActor],
    profiles: list[ActorSignalProfile],
    annotations: dict[str, ArtifactAnnotation],
    decisions: dict[int, LeadDecision],
    triage_result: Any | None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "generated_at": _iso_now(),
        "case": {
            "case_id": case.case_id,
            "title": case.title,
            "fir_number": case.fir_number,
            "station": case.station,
            "investigating_officer": case.investigating_officer,
            "status": case.status,
            "created_at": case.created_at.isoformat()
            if hasattr(case.created_at, "isoformat")
            else str(case.created_at),
        },
        "evidence": _evidence_summary(artifacts),
        "identities": _identity_summary(identities),
        "persons_of_interest": _persons_of_interest(profiles),
        "findings": _findings(triage_result, decisions),
    }
    report["annotations"] = _annotation_summary(annotations)
    report["method"] = _method_notes(report["evidence"], report["findings"])
    report["markdown"] = render_markdown(report)
    return report


# --------------------------------------------------------------------------
# Markdown rendering — one source of truth for the exported file and the
# text shown on screen.
# --------------------------------------------------------------------------


def _fmt_time(value: str | None) -> str:
    if not value:
        return "—"
    return value.replace("T", " ").replace("+00:00", " UTC").replace("Z", " UTC")


def render_markdown(report: dict[str, Any]) -> str:
    case = report["case"]
    evidence = report["evidence"]
    identities = report["identities"]
    people = report["persons_of_interest"]
    findings = report["findings"]
    annotations = report["annotations"]

    lines: list[str] = []
    add = lines.append

    add(f"# Case report — {case['title']}")
    add("")
    add(f"- **FIR number:** {case['fir_number'] or '—'}")
    add(f"- **Station:** {case['station'] or '—'}")
    add(f"- **Investigating officer:** {case['investigating_officer'] or '—'}")
    add(f"- **Case status:** {case['status']}")
    add(f"- **Case ID:** `{case['case_id']}`")
    add(f"- **Report generated:** {_fmt_time(report['generated_at'])}")
    add("")
    add(
        "> Generated by ACPIA from the ingested evidence. Every figure below is "
        "counted from the artifact store and every finding cites the artifacts it "
        "rests on. Synthetic case data — no real evidence is processed by this build."
    )
    add("")

    add("## 1. Evidence summary")
    add("")
    add(f"{evidence['total']} artifacts parsed, {evidence['flagged']} flagged.")
    add("")
    for row in evidence["by_type"]:
        add(f"- {row['label']}: {row['count']}")
    add("")
    add(
        "- **Sources:** "
        + ", ".join(f"{s['source']} ({s['count']})" for s in evidence["sources"])
    )
    add(
        f"- **Period covered:** {_fmt_time(evidence['first_event'])} "
        f"to {_fmt_time(evidence['last_event'])}"
    )
    add("")

    if evidence["flagged_artifacts"]:
        add("### Flagged artifacts")
        add("")
        for item in evidence["flagged_artifacts"]:
            add(
                f"- `{item['artifact_id']}` — {item['source']} — "
                f"{', '.join(item['flags'])} — {_fmt_time(item['time'])}"
            )
        add("")

    add("## 2. Identity resolution")
    add("")
    add(
        f"{identities['resolved_actors']} distinct actors resolved from the "
        "identifiers appearing across the evidence."
    )
    add("")
    if identities["cross_channel"]:
        add(
            "Actors appearing under more than one identifier or on more than one "
            "channel:"
        )
        add("")
        for actor in identities["cross_channel"]:
            add(
                f"- **{actor['label']}** — {', '.join(f'`{i}`' for i in actor['identifiers'])} "
                f"across {', '.join(actor['channels'])} ({actor['artifact_count']} artifacts)"
            )
        add("")

    add("## 3. Persons of interest")
    add("")
    if not people:
        add(
            f"No actor reaches the concern threshold ({CONCERN_THRESHOLD:.2f}) on the "
            "deterministic signal scoring."
        )
        add("")
    else:
        add(
            f"Actors at or above the concern threshold ({CONCERN_THRESHOLD:.2f}). Scoring "
            "is deterministic — lexical signals attributed to the message author, with "
            "phrases echoed back by the other party excluded — and no model is involved."
        )
        add("")
        for person in people:
            add(f"### {person['label']} — risk score {person['risk_score']:.2f}")
            add("")
            add(
                f"- **Identifiers:** {', '.join(f'`{i}`' for i in person['identifiers'])}"
            )
            add(f"- **Channels:** {', '.join(person['channels'])}")
            add(
                f"- **Messages authored:** {person['messages_authored']} "
                f"across {len(person['counterparties'])} contacts"
            )
            counts = person["signal_counts"]
            if counts:
                add(
                    "- **Signals:** "
                    + ", ".join(
                        f"{count} {signal.replace('_', ' ')}"
                        for signal, count in sorted(
                            counts.items(), key=lambda kv: -kv[1]
                        )
                    )
                )
            add(
                f"- **Late-night activity:** {person['late_night_ratio']:.0%} of messages "
                "between 22:00 and 02:00"
            )
            add(f"- **Escalation slope:** {person['escalation_slope']:.2f}")
            if person["evidence"]:
                add(
                    "- **Evidence:** "
                    + ", ".join(f"`{e}`" for e in person["evidence"])
                )
            add("")

    add("## 4. Findings")
    add("")
    if not findings["triage_run"]:
        add(
            "Triage has not been run for this case, so there are no reviewed leads to "
            "report. Open the Triage tab and rule on the leads to populate this section."
        )
        add("")
    elif not findings["confirmed"] and not findings["flagged_for_review"]:
        add(
            "No lead has been confirmed by the investigating officer. This report "
            "therefore contains the evidence summary above but states no findings."
        )
        add("")
    else:
        add(
            "Only leads an investigating officer has confirmed appear as findings. "
            "Leads that were rejected are excluded and counted in section 5."
        )
        add("")
        for i, lead in enumerate(findings["confirmed"], start=1):
            add(f"### Finding {i}: {lead['title']}")
            add("")
            add(f"- **Priority:** {lead['priority']}")
            if lead["actors"]:
                add(f"- **Actors:** {', '.join(lead['actors'])}")
            add("")
            add(lead["summary"])
            add("")
            add(f"**Evidence:** {', '.join(f'`{e}`' for e in lead['evidence'])}")
            add("")
            add(f"**Recommended action:** {lead['recommended_action']}")
            if lead["note"]:
                add("")
                add(f"**Officer's note:** {lead['note']}")
            add("")

        if findings["flagged_for_review"]:
            add("### Flagged for further review")
            add("")
            for lead in findings["flagged_for_review"]:
                add(
                    f"- **{lead['title']}** — evidence "
                    f"{', '.join(f'`{e}`' for e in lead['evidence'])}"
                )
            add("")

    add("## 5. Review position")
    add("")
    if findings["triage_run"]:
        add(f"- Leads confirmed: {len(findings['confirmed'])}")
        add(f"- Leads flagged for further review: {len(findings['flagged_for_review'])}")
        add(f"- Leads rejected by the officer: {findings['rejected_count']}")
        add(f"- Leads not yet ruled on: {findings['undecided_count']}")
        source = findings["source"]
        if source == "agent":
            add(f"- Leads produced by: agentic triage ({findings['model']})")
        elif source == "rules":
            add("- Leads produced by: deterministic rule-based triage")
        add("")
    else:
        add("- Triage not run for this case.")
        add("")

    if annotations["count"]:
        add("### Investigator annotations")
        add("")
        for item in annotations["items"]:
            parts = []
            if item["tags"]:
                parts.append(", ".join(item["tags"]))
            if (item["notes"] or "").strip():
                parts.append(item["notes"].strip())
            add(f"- `{item['artifact_id']}` — {' — '.join(parts)}")
        add("")

    add("## 6. Method and limitations")
    add("")
    for note in report.get("method", []):
        add(f"- {note}")
    add("")

    return "\n".join(lines)

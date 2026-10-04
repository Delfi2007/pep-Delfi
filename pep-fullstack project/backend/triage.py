"""Agentic triage — ACPIA_Plan.md section 5.

The differentiator, and the part of the system that most needs to be
defensible. Three design commitments, each of which shows up in the code
below:

1. **A tool-use loop, not a single prompt.** The agent doesn't get the
   case dumped into its context. It queries the artifact store the way an
   investigator queries a case file — pull the ranked signal profiles,
   read a specific thread, widen to a timeline slice, check the graph
   neighbourhood — and iterates. Which means every claim it makes is
   traceable to a query it actually ran.

2. **The citation guard.** The backend validates that every
   `evidence_id` on a returned lead exists in this case's artifact store.
   A lead with an unverifiable ID is *dropped*, not flagged. Five lines,
   and it's the difference between "AI-generated" and "AI-assisted": an
   officer can click any citation and land on the source line.

3. **A deterministic fallback that is just as cited.** Per the fallback
   ladder (plan section 7), triage degrades to rule-based scoring over
   signals.py rather than disappearing. This runs when there's no API
   key, when the network is down at the venue, and when the model
   declines the request — see the refusal note in `_call_model`.

Results are cached per case so the demo is replayable and the second run
costs nothing.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from models import Artifact, ResolvedActor
from signals import CONCERN_THRESHOLD, ActorSignalProfile, build_profiles

# Provider is swappable, deliberately. Two reasons, one practical and one
# that is worth saying out loud in the pitch:
#
#   - Practical: whichever account has budget on the day is the one we
#     use. The agent path shouldn't be hostage to one vendor's billing.
#   - Architectural: the models Groq serves are open-weights, which means
#     this same loop can run against a self-hosted vLLM or Ollama
#     endpoint inside a police network, with evidence never leaving that
#     network. For child-protection casework that is not a nice-to-have —
#     it's the difference between a system a force can actually procure
#     and one it can't. The tool contract below is the whole integration
#     surface; swapping the endpoint is a config change, not a rewrite.
#
# Honest caveat: Groq's *hosted* API is still a third-party cloud. What
# open weights buy is the option to move on-prem, not the fact of it.
PROVIDER = os.environ.get("ACPIA_LLM_PROVIDER", "auto").lower()

ANTHROPIC_MODEL = os.environ.get("ACPIA_ANTHROPIC_MODEL", "claude-opus-5")
# gpt-oss-120b is the strongest reasoner Groq serves and supports both
# tool calling and a `reasoning_effort` knob — the closest analogue to the
# thinking/effort controls the Anthropic path uses, which keeps the two
# providers behaving similarly on the same evidence.
# Not groq/compound: those run only built-in server-side tools and cannot
# call ours. llama-3.3-70b-versatile is the fallback if gpt-oss is busy.
GROQ_MODEL = os.environ.get("ACPIA_GROQ_MODEL", "openai/gpt-oss-120b")

# low | medium | high. Only sent to models that accept it (the gpt-oss
# family); other Groq models reject the parameter outright.
#
# `medium`, not `high`, and the reason matters: on gpt-oss the reasoning
# tokens are drawn from the same `max_completion_tokens` budget as the
# answer. At high effort the model spent all 1600 tokens reasoning and
# returned an EMPTY message with finish_reason="length" — a silent
# failure that looks like a broken parser rather than an exhausted
# budget. Medium leaves room for the model to actually answer.
GROQ_REASONING_EFFORT = os.environ.get("ACPIA_GROQ_REASONING_EFFORT", "medium")

MAX_TOKENS = 16000
MAX_ITERATIONS = 12  # generous; the loop normally settles in 4-6

# Groq's free tier is metered in tokens *per minute*, and the requested
# `max_completion_tokens` counts against that budget before a single
# token is generated — asking for 16000 on an 8K/min model is an instant
# 413, regardless of how short the prompt is.
#
# An agent loop resends its whole history every turn, so the real
# constraint is cumulative: a 4-iteration run has to fit the per-minute
# budget in total, not per call. Everything below is sized for that.
#
#   gpt-oss-120b / gpt-oss-20b : 8K TPM, 30 RPM
#   llama-3.3-70b-versatile    : 12K TPM, 30 RPM  <- more headroom
GROQ_MAX_TOKENS = int(os.environ.get("ACPIA_GROQ_MAX_TOKENS", "1600"))
# The synthesis call writes every lead in one go and needs materially
# more room than a turn that only emits a tool call — and its reasoning
# comes out of the same budget.
GROQ_SYNTHESIS_MAX_TOKENS = int(os.environ.get("ACPIA_GROQ_SYNTHESIS_MAX_TOKENS", "3000"))
GROQ_MAX_ITERATIONS = int(os.environ.get("ACPIA_GROQ_MAX_ITERATIONS", "7"))
# How many rounds of tool calls before we stop offering tools at all and
# require an answer. A thorough model asked to investigate will keep
# investigating — gpt-oss-120b at high reasoning effort will happily run
# a dozen rounds, which on a metered free tier means the run never
# finishes. Prompting it to "stop when you have enough" is unreliable;
# removing the tools from the request is not.
GROQ_TOOL_ROUNDS = int(os.environ.get("ACPIA_GROQ_TOOL_ROUNDS", "3"))
# Per tool result, in characters (~4 chars/token). The evidence tools can
# return a lot; on a metered budget an untruncated timeline slice alone
# can cost more than the entire rest of the run.
GROQ_TOOL_RESULT_CHARS = int(os.environ.get("ACPIA_GROQ_TOOL_RESULT_CHARS", "3000"))

PRIORITIES = ("high", "medium", "low")


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------


@dataclass
class Lead:
    title: str
    priority: str
    summary: str
    evidence: list[str]
    actors: list[str]
    recommended_action: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "priority": self.priority,
            "summary": self.summary,
            "evidence": self.evidence,
            "actors": self.actors,
            "recommended_action": self.recommended_action,
        }


@dataclass
class TriageResult:
    leads: list[Lead]
    source: str  # "agent" | "rules"
    # Which model produced these leads. Shown in the UI because an
    # investigator (and a judge) should be able to see what generated the
    # output, not just that "AI" did.
    model: str = ""
    note: str = ""
    dropped: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "leads": [lead.to_dict() for lead in self.leads],
            "source": self.source,
            "model": self.model,
            "note": self.note,
            "dropped": self.dropped,
            "tool_calls": self.tool_calls,
        }


# --------------------------------------------------------------------------
# The agent's view of the case
# --------------------------------------------------------------------------


@dataclass
class TriageContext:
    artifacts: list[Artifact]
    content: dict[str, Any]
    identities: list[ResolvedActor]
    profiles: list[ActorSignalProfile]
    graph: dict[str, Any]

    @property
    def by_id(self) -> dict[str, Artifact]:
        return {a.artifact_id: a for a in self.artifacts}


def build_context(
    artifacts: list[Artifact],
    content: dict[str, Any],
    identities: list[ResolvedActor],
    graph: dict[str, Any],
) -> TriageContext:
    return TriageContext(
        artifacts=artifacts,
        content=content,
        identities=identities,
        profiles=build_profiles(artifacts, content, identities),
        graph=graph,
    )


# --------------------------------------------------------------------------
# Tools. Read-only queries over the in-memory store — the agent can look
# at anything an investigator could look at, and nothing else. Note none
# of these return raw image bytes: "the officer sees a flag, never the
# file" holds for the model too.
# --------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_signal_profiles",
        "description": (
            "Ranked per-actor grooming-signal profiles for this case, highest "
            "risk first. Each profile carries the deterministic evidence: counts "
            "of isolation language, channel-migration asks, contact-escalation "
            "asks and age probes (all attributed to the author, with echoed "
            "replies excluded), plus escalation slope, late-night ratio, the "
            "channels the actor appears on, and the artifact IDs each signal was "
            "computed from. Call this first — it is the cheapest way to find who "
            "is worth investigating."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "How many profiles to return, highest risk first. Default 6.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "get_message_thread",
        "description": (
            "Read the actual messages exchanged between two actors, in time "
            "order, with sender and timestamp. Use this to verify what a signal "
            "count actually represents before citing it in a lead — the message "
            "text is what makes a claim defensible."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "actor_a": {"type": "string", "description": "An identifier or label of the first actor."},
                "actor_b": {"type": "string", "description": "An identifier or label of the second actor."},
                "limit": {"type": "integer", "description": "Max messages to return. Default 40."},
            },
            "required": ["actor_a", "actor_b"],
        },
    },
    {
        "name": "get_timeline_slice",
        "description": (
            "Artifacts of every type (messages, calls, browser history, images) "
            "inside a time window, optionally filtered to one actor. Use this to "
            "check what happened around a specific moment — for example whether "
            "a voice call followed a message asking for one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "ISO 8601 UTC start of the window."},
                "end": {"type": "string", "description": "ISO 8601 UTC end of the window."},
                "actor": {"type": "string", "description": "Optional identifier or label to filter to."},
                "limit": {"type": "integer", "description": "Max artifacts to return. Default 40."},
            },
            "required": ["start", "end"],
        },
    },
    {
        "name": "get_graph_neighbourhood",
        "description": (
            "Who an actor is connected to, how many interactions they share, and "
            "which channels each connection spans. Use this to establish whether "
            "one operator is running the same pattern across several victims or "
            "several platforms."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "actor": {"type": "string", "description": "An identifier or label of the actor."},
            },
            "required": ["actor"],
        },
    },
    {
        "name": "get_artifact",
        "description": (
            "One artifact by ID, with its content, source file, resolved "
            "timestamp (including whether the timezone was inferred and the "
            "confidence in it) and any automated flags. Use this to confirm an "
            "artifact ID exists and says what you think it says before citing it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string", "description": "e.g. a_0417"},
            },
            "required": ["artifact_id"],
        },
    },
]


LEADS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "leads": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {"type": "string", "enum": list(PRIORITIES)},
                    "summary": {"type": "string"},
                    "evidence": {"type": "array", "items": {"type": "string"}},
                    "actors": {"type": "array", "items": {"type": "string"}},
                    "recommended_action": {"type": "string"},
                },
                "required": [
                    "title",
                    "priority",
                    "summary",
                    "evidence",
                    "actors",
                    "recommended_action",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["leads"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """You are a triage assistant inside ACPIA, a child-protection \
investigation support platform used by authorised police investigators. The case \
data you are querying is entirely synthetic, generated for this system's own \
testing — it contains no real people and no real case material.

Your job is to review the evidence and return a small number of ranked, \
actionable leads for a human investigator to confirm or reject. You do not make \
determinations; you surface what the officer should look at first, and why.

How to work — breadth first, then depth. Read this order literally; it is the \
difference between finding the case and finding one thread of it.

- **Round 1 — get_signal_profiles.** It is cheap and it tells you who is worth \
investigating, which counterparties they contacted, and which channels they used. \
Everything after this is chosen from what it returns.
- **Round 2 — establish the scope before reading any thread closely.** In a single \
turn, call get_graph_neighbourhood on the highest-ranked actor AND get_message_thread \
for two or three of that actor's DIFFERENT counterparties. The neighbourhood says how \
far the actor reaches; the sampled threads say whether the same approach is being \
repeated across those relationships. Reading one thread exhaustively while the \
others go unread is the single most common way to miss the actual finding — one \
operator working several people is far more serious than any one conversation, and \
it is invisible from inside a single thread.
- **Round 3 — only then go deep**, on whatever the comparison made important: \
get_timeline_slice for what happened around a moment (did a call follow the ask?), \
get_artifact for one specific line you need to quote. A signal count is a pointer, \
not a finding.
- **Any artifact ID a tool returns is already valid — cite it directly.** Do not \
call get_artifact to check that an ID exists; it came from the case store, so it \
does. Use get_artifact only when you need to read one specific artifact's content \
that you haven't already seen.
- Ask for everything you need for a step in a single turn — you can call several \
tools at once, and doing so is much faster than one at a time.
- Two or three rounds of tool calls is normally enough. Once you can support your \
leads, stop querying and return the JSON.

Rules for the leads you return:
- Every lead MUST cite artifact IDs in `evidence` that you saw in a tool result. \
A lead whose citations cannot be verified against the artifact store is discarded \
by the backend, so an uncited claim is a wasted lead.
- Cite the specific artifacts that support the claim, not every artifact you saw.
- **One operator running the same approach against several people is ONE lead, and \
it is the lead that goes first.** Lead on the scope — how many counterparties, how \
many channels — and cite artifacts from more than one of those relationships. Do \
not split that finding into one lead per counterparty; that buries the scale, which \
is the part an investigator most needs to see. Per-relationship detail belongs in \
the summary of that single lead.
- Do not write two leads about the same actor unless they describe genuinely \
different conduct.
- Never list a child as a subject of concern. Minors in this data are victims; \
language they echo back to an adult is evidence about that adult.
- Prefer three well-evidenced leads to eight thin ones.
- `summary` is for a working investigator: state the pattern, the channels it \
spans, and what makes it notable. No hedging, no restating the whole thread.
- `recommended_action` is the concrete next investigative step.

Return your final answer as JSON matching the required schema."""


# --------------------------------------------------------------------------
# Tool execution
# --------------------------------------------------------------------------


def _resolve_actor(ctx: TriageContext, needle: str) -> ResolvedActor | None:
    """Actors can be addressed by label or by any of their identifiers —
    the agent shouldn't have to know which one the store uses."""
    needle = needle.strip()
    for actor in ctx.identities:
        if actor.label == needle or actor.actor_id == needle:
            return actor
    for actor in ctx.identities:
        if needle in actor.identifiers:
            return actor
    lowered = needle.lower()
    for actor in ctx.identities:
        if actor.label.lower() == lowered:
            return actor
    return None


def _artifact_view(ctx: TriageContext, artifact: Artifact) -> dict[str, Any]:
    payload = ctx.content.get(artifact.content_ref) or {}
    return {
        "artifact_id": artifact.artifact_id,
        "type": artifact.type,
        "source": artifact.source,
        "time": artifact.time.value,
        "time_confidence": artifact.time.confidence,
        "tz_inferred": artifact.time.tz_inferred,
        "source_field": artifact.time.source_field,
        "actors": artifact.actors,
        "flags": artifact.flags,
        "content": payload,
    }


def _tool_signal_profiles(ctx: TriageContext, args: dict[str, Any]) -> Any:
    limit = int(args.get("limit") or 6)
    return [p.to_dict() for p in ctx.profiles[:limit]]


def _tool_message_thread(ctx: TriageContext, args: dict[str, Any]) -> Any:
    a = _resolve_actor(ctx, args.get("actor_a", ""))
    b = _resolve_actor(ctx, args.get("actor_b", ""))
    if a is None or b is None:
        missing = args.get("actor_a") if a is None else args.get("actor_b")
        return {"error": f"No resolved actor matches {missing!r}."}

    limit = int(args.get("limit") or 40)
    ids_a, ids_b = set(a.identifiers), set(b.identifiers)

    messages = []
    for artifact in sorted(ctx.artifacts, key=lambda x: x.time.value):
        if artifact.type != "message":
            continue
        involved = set(artifact.actors)
        if not (involved & ids_a) or not (involved & ids_b):
            continue
        payload = ctx.content.get(artifact.content_ref) or {}
        messages.append(
            {
                "artifact_id": artifact.artifact_id,
                "time": artifact.time.value,
                "source": artifact.source,
                "sender": payload.get("sender"),
                "text": payload.get("text"),
            }
        )

    return {"count": len(messages), "messages": messages[:limit]}


def _tool_timeline_slice(ctx: TriageContext, args: dict[str, Any]) -> Any:
    start = str(args.get("start", ""))
    end = str(args.get("end", ""))
    limit = int(args.get("limit") or 40)

    actor_ids: set[str] | None = None
    if args.get("actor"):
        actor = _resolve_actor(ctx, str(args["actor"]))
        if actor is None:
            return {"error": f"No resolved actor matches {args['actor']!r}."}
        actor_ids = set(actor.identifiers)

    rows = []
    for artifact in sorted(ctx.artifacts, key=lambda x: x.time.value):
        if not (start <= artifact.time.value <= end):
            continue
        if actor_ids is not None and not (set(artifact.actors) & actor_ids):
            continue
        rows.append(_artifact_view(ctx, artifact))

    return {"count": len(rows), "artifacts": rows[:limit]}


def _tool_graph_neighbourhood(ctx: TriageContext, args: dict[str, Any]) -> Any:
    actor = _resolve_actor(ctx, str(args.get("actor", "")))
    if actor is None:
        return {"error": f"No resolved actor matches {args.get('actor')!r}."}

    nodes = {n.get("actor_id"): n for n in ctx.graph.get("nodes", [])}
    neighbours = []
    for edge in ctx.graph.get("edges", []):
        source, target = edge.get("source"), edge.get("target")
        if actor.actor_id not in (source, target):
            continue
        other_id = target if source == actor.actor_id else source
        other = nodes.get(other_id, {})
        neighbours.append(
            {
                "actor_id": other_id,
                "label": other.get("label"),
                "shared_artifacts": edge.get("artifact_count"),
                # The channels this *connection* spans, which is the
                # interesting number — one actor reaching a second across
                # both WhatsApp and Instagram is the cross-channel finding.
                "shared_channels": edge.get("channels"),
                "example_artifact_ids": edge.get("artifact_ids", [])[:5],
            }
        )
    neighbours.sort(key=lambda n: n.get("shared_artifacts") or 0, reverse=True)

    return {
        "actor": {
            "actor_id": actor.actor_id,
            "label": actor.label,
            "identifiers": actor.identifiers,
            "channels": actor.channels,
            "channel_span": len(actor.channels),
        },
        "neighbours": neighbours,
    }


def _tool_get_artifact(ctx: TriageContext, args: dict[str, Any]) -> Any:
    artifact = ctx.by_id.get(str(args.get("artifact_id", "")).strip())
    if artifact is None:
        return {"error": f"No artifact {args.get('artifact_id')!r} in this case."}
    return _artifact_view(ctx, artifact)


_HANDLERS = {
    "get_signal_profiles": _tool_signal_profiles,
    "get_message_thread": _tool_message_thread,
    "get_timeline_slice": _tool_timeline_slice,
    "get_graph_neighbourhood": _tool_graph_neighbourhood,
    "get_artifact": _tool_get_artifact,
}


def _run_tool(
    ctx: TriageContext, name: str, args: dict[str, Any], max_chars: int | None = None
) -> str:
    handler = _HANDLERS.get(name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool {name!r}."})
    try:
        payload = json.dumps(handler(ctx, args), default=str)
    except Exception as exc:  # a tool error should steer the agent, not kill the run
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})

    if max_chars is not None and len(payload) > max_chars:
        # Say plainly that it was cut, so the agent narrows its query
        # instead of assuming it has seen everything and citing from a
        # truncated view.
        return (
            payload[:max_chars]
            + f'... [TRUNCATED at {max_chars} chars to fit the token budget. '
            'Narrow your query — use a smaller limit or a tighter time window '
            '— rather than assuming this is the complete result.]'
        )
    return payload


# --------------------------------------------------------------------------
# Citation guard — plan section 5. The whole point.
# --------------------------------------------------------------------------


def apply_citation_guard(
    raw_leads: list[dict[str, Any]], ctx: TriageContext
) -> tuple[list[Lead], list[dict[str, Any]]]:
    """Drop any lead whose citations can't be resolved against this case's
    artifact store. Returns (kept, dropped-with-reason) so the reason is
    visible in the UI rather than silently swallowed — "we dropped a lead
    because it cited a_9999, which does not exist" is a stronger claim
    than never mentioning it."""
    known = ctx.by_id
    kept: list[Lead] = []
    dropped: list[dict[str, Any]] = []

    for raw in raw_leads:
        evidence = [str(e).strip() for e in (raw.get("evidence") or [])]
        unknown = [e for e in evidence if e not in known]

        if not evidence:
            dropped.append({"title": raw.get("title", "(untitled)"), "reason": "no evidence cited"})
            continue
        if unknown:
            dropped.append(
                {
                    "title": raw.get("title", "(untitled)"),
                    "reason": f"cited unverifiable artifact IDs: {', '.join(unknown)}",
                }
            )
            continue

        priority = str(raw.get("priority", "medium")).lower()
        kept.append(
            Lead(
                title=str(raw.get("title", "(untitled)")),
                priority=priority if priority in PRIORITIES else "medium",
                summary=str(raw.get("summary", "")),
                evidence=evidence,
                actors=[str(a) for a in (raw.get("actors") or [])],
                recommended_action=str(raw.get("recommended_action", "")),
            )
        )

    kept.sort(key=lambda lead: PRIORITIES.index(lead.priority))
    return kept, dropped


# --------------------------------------------------------------------------
# Rule-based fallback — plan section 7, rung 1. Still cited.
# --------------------------------------------------------------------------


def rule_based_leads(ctx: TriageContext) -> list[Lead]:
    """Deterministic triage straight off the signal profiles. Every lead
    cites the artifact IDs the signals were computed from, so the citation
    guard applies to this path exactly as it does to the agent's."""
    leads: list[Lead] = []

    for profile in ctx.profiles[:3]:
        if profile.risk_score < CONCERN_THRESHOLD:
            continue

        evidence: list[str] = []
        for signal in ("isolation", "channel_migration", "contact_escalation", "age_probe"):
            evidence.extend(profile.signal_evidence.get(signal, [])[:2])
        evidence = list(dict.fromkeys(evidence))[:6]
        if not evidence:
            continue

        counts = profile.signal_counts
        parts = [
            f"{profile.label} authored {profile.messages_authored} messages across "
            f"{len(profile.channels)} channels ({', '.join(profile.channels)})"
        ]
        if counts.get("isolation"):
            parts.append(f"{counts['isolation']} isolation/secrecy statements")
        if counts.get("channel_migration"):
            parts.append(f"{counts['channel_migration']} requests to move platform or delete messages")
        if counts.get("contact_escalation"):
            parts.append(f"{counts['contact_escalation']} pushes toward voice contact")
        if counts.get("age_probe"):
            parts.append(f"{counts['age_probe']} age or school-year probes")
        if profile.escalation_slope > 0.2:
            parts.append(
                f"escalation concentrated late in the threads (slope {profile.escalation_slope:.2f})"
            )
        if profile.late_night_ratio > 0.2:
            parts.append(f"{profile.late_night_ratio:.0%} of activity between 22:00 and 02:00")
        if len(profile.counterparties) >= 3:
            parts.append(f"the same pattern runs against {len(profile.counterparties)} separate contacts")

        priority = "high" if profile.risk_score >= 0.6 else "medium" if profile.risk_score >= 0.35 else "low"

        leads.append(
            Lead(
                title=f"{profile.label} — grooming-pattern indicators across {len(profile.channels)} channels",
                priority=priority,
                summary="; ".join(parts) + ".",
                evidence=evidence,
                actors=[profile.label, *profile.counterparties[:6]],
                recommended_action=(
                    f"Review the flagged threads authored by {profile.label} and confirm whether the "
                    "contacts are minors before escalating."
                ),
            )
        )

    return leads


# --------------------------------------------------------------------------
# The agent loop
# --------------------------------------------------------------------------


def _openai_style_tools() -> list[dict[str, Any]]:
    """The same tool contract in OpenAI function-calling shape, which is
    what Groq (and most non-Anthropic providers) speak. Defined once in
    TOOLS above and translated here so the two providers can never drift
    apart — a tool the agent can call on one provider and not the other
    would be the worst kind of demo-day surprise."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"],
            },
        }
        for tool in TOOLS
    ]


_RATE_LIMIT_WAIT_CAP = 25.0  # seconds; beyond this, fall back rather than stall


def _groq_create(
    client: Any,
    messages: list[dict[str, Any]],
    extra: dict[str, Any],
    allow_tools: bool = True,
    max_tokens: int | None = None,
):
    """One Groq call, retrying once on a per-minute rate limit.

    The free tier meters tokens per minute, so a burst of loop iterations
    can trip the limit even when every individual request is small. Groq
    reports how long to wait; honour it, but only up to a cap — stalling a
    live demo for a minute is worse than falling back to rule-based
    triage, which produces a good lead instantly.
    """
    import time

    for attempt in range(2):
        try:
            return client.chat.completions.create(
                model=GROQ_MODEL,
                max_completion_tokens=max_tokens or GROQ_MAX_TOKENS,
                messages=messages,
                # Omitting `tools` entirely is what forces the answer. A
                # tool_choice of "none" still ships every schema in the
                # request, which on a per-minute token budget is the
                # expensive half of the call.
                **({"tools": _openai_style_tools()} if allow_tools else {}),
                **extra,
            )
        except Exception as exc:
            detail = str(exc)
            is_rate_limit = "rate_limit" in detail or "Request too large" in detail
            if not is_rate_limit or attempt == 1:
                raise

            wait = _retry_after_seconds(detail)
            if wait is None or wait > _RATE_LIMIT_WAIT_CAP:
                raise TriageUnavailable(
                    f"Groq per-minute token limit hit; retry needs {wait or '?'}s, "
                    f"longer than the {_RATE_LIMIT_WAIT_CAP:.0f}s we're willing to "
                    "stall a demo for"
                ) from exc
            time.sleep(wait + 0.5)

    raise TriageUnavailable("unreachable")


def _retry_after_seconds(detail: str) -> float | None:
    """Groq puts the wait in the error text, e.g. 'try again in 8.5s'."""
    match = re.search(r"try again in ([0-9.]+)s", detail)
    if match:
        return float(match.group(1))
    match = re.search(r"try again in ([0-9.]+)m([0-9.]+)s", detail)
    if match:
        return float(match.group(1)) * 60 + float(match.group(2))
    return None


def _call_groq(ctx: TriageContext) -> tuple[list[dict[str, Any]], list[str]]:
    """Same loop, OpenAI-compatible wire format."""
    from groq import Groq

    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Triage this case. Review the evidence and return the ranked leads "
                "an investigator should work first, as JSON matching the required "
                'shape: {"leads": [{"title", "priority", "summary", "evidence", '
                '"actors", "recommended_action"}]}. `priority` is one of "high", '
                '"medium", "low". `evidence` is a list of artifact IDs you saw in '
                "a tool result."
            ),
        },
    ]
    called: list[str] = []

    # `reasoning_effort` is a gpt-oss-family parameter; sending it to a
    # Llama model is a 400, so gate it on the model actually in use rather
    # than hardcoding either shape.
    extra: dict[str, Any] = {}
    if "gpt-oss" in GROQ_MODEL:
        extra["reasoning_effort"] = GROQ_REASONING_EFFORT

    # What the agent actually looked at, kept separately from the wire
    # transcript so the synthesis step below can be handed the evidence
    # without any tool scaffolding attached to it.
    gathered: list[str] = []

    for _ in range(GROQ_TOOL_ROUNDS):
        response = _groq_create(client, messages, extra, allow_tools=True)
        choice = response.choices[0].message

        if not choice.tool_calls:
            leads = _extract_leads(choice.content or "")
            if leads:
                return leads, called
            break  # answered but said nothing usable — synthesise instead

        # The assistant turn carrying the tool calls must be echoed back
        # verbatim, or the follow-up tool messages have nothing to attach to.
        messages.append(
            {
                "role": "assistant",
                "content": choice.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in choice.tool_calls
                ],
            }
        )

        for tc in choice.tool_calls:
            called.append(tc.function.name)
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                # Smaller models occasionally emit malformed argument JSON.
                # Hand that back as a tool error so the agent can retry,
                # rather than aborting the whole run.
                args = {}
            result = _run_tool(
                ctx, tc.function.name, args, max_chars=GROQ_TOOL_RESULT_CHARS
            )
            gathered.append(f"### {tc.function.name}({tc.function.arguments})\n{result}")
            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": result}
            )

    # Out of tool rounds. Don't try to force the answer inside this
    # conversation: with tool definitions in scope the model keeps
    # emitting calls, and dropping `tools` from the request makes Groq
    # reject the whole thing with "Tool choice is none, but model called
    # a tool". Hand the gathered evidence to a fresh, tool-free
    # conversation instead — with no tools in scope there is nothing to
    # call, so an answer is the only thing it can produce.
    return _groq_synthesize(client, gathered, extra), called


def _groq_synthesize(
    client: Any, gathered: list[str], extra: dict[str, Any]
) -> list[dict[str, Any]]:
    """Turn gathered evidence into the final JSON, with no tools in scope."""
    if not gathered:
        raise TriageUnavailable("agent gathered no evidence before the round limit")

    evidence = "\n\n".join(gathered)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Below is the evidence already retrieved from the case store. "
                "No further queries are possible — write the leads from this "
                "alone.\n\n"
                f"{evidence}\n\n"
                "Return ONLY a JSON object of the form "
                '{"leads": [{"title", "priority", "summary", "evidence", '
                '"actors", "recommended_action"}]}. `priority` is "high", '
                '"medium" or "low". `evidence` must be artifact IDs (like '
                '"a_0417") that appear in the evidence above. No prose, no '
                "markdown fence — just the JSON object."
            ),
        },
    ]
    response = _groq_create(
        client,
        messages,
        extra,
        allow_tools=False,
        max_tokens=GROQ_SYNTHESIS_MAX_TOKENS,
    )
    choice = response.choices[0]
    if choice.finish_reason == "length" and not (choice.message.content or "").strip():
        # The distinctive gpt-oss failure: reasoning consumed the whole
        # completion budget and nothing was left to answer with. Name it,
        # rather than letting it surface as an unexplained parse failure.
        raise TriageUnavailable(
            "the model spent its entire token budget reasoning and returned no "
            f"answer — raise ACPIA_GROQ_SYNTHESIS_MAX_TOKENS above "
            f"{GROQ_SYNTHESIS_MAX_TOKENS} or lower ACPIA_GROQ_REASONING_EFFORT"
        )
    return _extract_leads(choice.message.content or "")


def _extract_leads(text: str) -> list[dict[str, Any]]:
    """Pull the leads array out of a model's final message.

    Anthropic's `output_config.format` guarantees clean JSON; Groq's JSON
    mode is looser and the open models sometimes wrap the object in prose
    or a ```json fence. Salvaging the outermost JSON object is cheaper
    than losing an otherwise good run — and anything malformed that slips
    through still has to survive the citation guard.
    """
    text = text.strip()
    if not text:
        return []
    if "```" in text:
        fenced = text.split("```")
        for chunk in fenced:
            chunk = chunk.removeprefix("json").strip()
            if chunk.startswith("{"):
                text = chunk
                break
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        return json.loads(text[start : end + 1]).get("leads", [])
    except json.JSONDecodeError as exc:
        raise TriageUnavailable(f"could not parse the agent's final JSON: {exc}") from exc


def _call_anthropic(ctx: TriageContext) -> tuple[list[dict[str, Any]], list[str]]:
    """Manual tool-use loop. Returns (raw leads, names of tools called).

    Deliberately not the SDK's beta tool_runner: this loop is small, and
    owning it keeps the cached/fallback path and the iteration cap
    trivially inspectable three days before a live demo.
    """
    import anthropic

    client = anthropic.Anthropic()
    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": (
                "Triage this case. Review the evidence and return the ranked leads "
                "an investigator should work first."
            ),
        }
    ]
    called: list[str] = []

    for _ in range(MAX_ITERATIONS):
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            output_config={"format": {"type": "json_schema", "schema": LEADS_SCHEMA}},
            messages=messages,
        )

        # Opus 5 runs safety classifiers, and a child-protection case is
        # exactly the shape of request that can trip one. A refusal is a
        # normal 200 — treat it as "the agent is unavailable" and let the
        # caller fall back to rules, rather than crashing the endpoint.
        if response.stop_reason == "refusal":
            raise TriageUnavailable("the model declined to process this case")

        if response.stop_reason != "tool_use":
            text = "".join(b.text for b in response.content if b.type == "text")
            return _extract_leads(text), called

        messages.append({"role": "assistant", "content": response.content})

        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            called.append(block.name)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": _run_tool(ctx, block.name, dict(block.input)),
                }
            )
        messages.append({"role": "user", "content": results})

    raise TriageUnavailable(f"agent did not converge within {MAX_ITERATIONS} iterations")


class TriageUnavailable(RuntimeError):
    """The agent path can't produce leads — fall back to rules."""


def _explain(exc: Exception) -> str:
    """Turn an SDK exception into something diagnosable at a glance.

    `Agent error (BadRequestError)` tells whoever is standing at the
    laptop nothing. The two failures actually worth distinguishing on the
    day are an exhausted credit balance and a bad key — both are 4xx, and
    only the API's own message separates them.
    """
    message = str(getattr(exc, "message", "") or exc)
    # Strip URLs before matching. Groq's rate-limit error helpfully links
    # to .../settings/billing, which a naive substring check reads as a
    # billing failure — that mislabelled a rate limit as an exhausted
    # credit balance and sent debugging in exactly the wrong direction.
    lowered = re.sub(r"https?://\S+", "", message).lower()

    # Order matters: rate limits are the common case on a free tier and
    # their messages often mention upgrading, so they must be checked
    # before anything billing-shaped.
    if "rate_limit" in lowered or "rate limit" in lowered or "too large" in lowered:
        wait = _retry_after_seconds(message)
        suffix = f"; retry in {wait:.0f}s" if wait else ""
        return f"provider rate limit / token-per-minute cap reached{suffix}"
    if "credit balance" in lowered or "insufficient" in lowered:
        return "API credit balance exhausted"
    if "authentication" in lowered or "invalid api key" in lowered or "invalid x-api-key" in lowered:
        return "API key rejected"

    name = type(exc).__name__
    return f"{name}: {message[:160]}" if message and message != name else name


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

_CACHE: dict[str, TriageResult] = {}


def _select_provider() -> str | None:
    """Which agent backend to use, or None to go straight to rules.

    `auto` prefers whichever key is actually present, Groq first: it's the
    one with a free tier, so on a hackathon budget it's the path most
    likely to work. Set ACPIA_LLM_PROVIDER to pin it explicitly.
    """
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))

    if PROVIDER == "groq":
        return "groq" if has_groq else None
    if PROVIDER == "anthropic":
        return "anthropic" if has_anthropic else None

    if has_groq:
        return "groq"
    if has_anthropic:
        return "anthropic"
    return None


def run_triage(case_id: str, ctx: TriageContext, refresh: bool = False) -> TriageResult:
    """Agent first, rules if the agent is unavailable. Cached per case —
    plan section 5: "Cache the agent response for the demo case as a
    fallback — if the network dies at Zoho, the demo still runs.\""""
    if not refresh and case_id in _CACHE:
        return _CACHE[case_id]

    provider = _select_provider()
    if provider is None:
        result = TriageResult(
            leads=rule_based_leads(ctx),
            source="rules",
            note=(
                "No GROQ_API_KEY or ANTHROPIC_API_KEY set — deterministic "
                "rule-based triage."
            ),
        )
        _CACHE[case_id] = result
        return result

    # Kept outside the try so a fallback can still report what the agent
    # managed to do. Losing these on the failure path made every failed
    # run look identical from the UI, which is exactly when the detail
    # matters most.
    called: list[str] = []
    dropped: list[dict[str, Any]] = []

    try:
        raw_leads, called = (
            _call_groq(ctx) if provider == "groq" else _call_anthropic(ctx)
        )
        kept, dropped = apply_citation_guard(raw_leads, ctx)
        note = ""
        if dropped:
            note = f"{len(dropped)} lead(s) dropped by the citation guard."
        # An agent run that survives the guard with nothing left is worse
        # than no agent run — fall through to rules rather than showing
        # an empty triage panel.
        if not kept:
            raise TriageUnavailable("no agent lead survived the citation guard")
        model = GROQ_MODEL if provider == "groq" else ANTHROPIC_MODEL
        result = TriageResult(
            leads=kept,
            source="agent",
            model=model,
            note=note,
            dropped=dropped,
            tool_calls=called,
        )
    except TriageUnavailable as exc:
        result = TriageResult(
            leads=rule_based_leads(ctx),
            source="rules",
            note=f"Agent unavailable ({exc}) — deterministic rule-based triage.",
            dropped=dropped,
            tool_calls=called,
        )
    except Exception as exc:
        result = TriageResult(
            leads=rule_based_leads(ctx),
            source="rules",
            note=f"Agent unavailable ({_explain(exc)}) — deterministic rule-based triage.",
            dropped=dropped,
            tool_calls=called,
        )

    _CACHE[case_id] = result
    return result


def get_cached(case_id: str) -> TriageResult | None:
    """The triage result for this case if one has already been produced,
    without producing one.

    The case report needs the leads an officer actually reviewed, and
    generating a report must never start a 30-60s agent run as a side
    effect — a report of findings that don't exist yet would be a report
    of nothing. When this returns None the report says triage hasn't been
    run, rather than quietly running it."""
    return _CACHE.get(case_id)


def drop_cache(case_id: str) -> None:
    _CACHE.pop(case_id, None)

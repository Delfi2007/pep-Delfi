"""Effective runtime configuration — what the system is actually doing.

This is deliberately a *reader*, not a control panel. Nothing in this
build persists (no database, ACPIA_Plan.md section 3), so a Settings page
that let you flip a switch would be storing that switch in the same RAM a
restart wipes — fake state of exactly the kind the rest of the app
refuses to invent. What an officer actually needs to know is which
provider will answer, which model, what the scoring thresholds are, and
that no real evidence is in play. So this endpoint answers that, and says
plainly how each value is set and how to change it.

Every value is imported from the module that owns it — the concern
threshold from signals.py, the correlation window from correlation.py, the
token budgets from triage.py — so a number shown here cannot drift from
the one actually in force. Duplicating them as literals would be the one
way to make a configuration screen lie.

Secrets are never returned. The API-key fields are booleans: whether a
key is present, never its value. A settings screen that echoed a key back
would be a credential leak dressed up as transparency.
"""

from __future__ import annotations

import os
from typing import Any

import alerts
import correlation
import parsers
import signals
import triage


def _env_source(name: str, default: str) -> dict[str, Any]:
    """Report an env-derived value together with how it's set, so the UI
    can show "default" vs "overridden" without guessing."""
    raw = os.environ.get(name)
    return {
        "env": name,
        "value": raw if raw is not None else default,
        "default": default,
        "overridden": raw is not None,
    }


def build_settings() -> dict[str, Any]:
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    effective = triage._select_provider()

    return {
        # How to read this page — stated once, so every section below can
        # be terse about it.
        "note": (
            "Configuration is read from environment variables at startup. "
            "This page shows what is in effect; to change a value, set its "
            "variable (in backend/.env or the shell) and restart the backend."
        ),
        "triage": {
            "provider_setting": _env_source("ACPIA_LLM_PROVIDER", "auto"),
            # What `auto` (or an explicit pin) actually resolves to given the
            # keys present right now. None means the agent can't run and
            # triage will use the deterministic rule-based path.
            "effective_provider": effective or "rules",
            "will_use_agent": effective is not None,
            # Presence only — never the key itself.
            "groq_key_present": has_groq,
            "anthropic_key_present": has_anthropic,
            "groq_model": triage.GROQ_MODEL,
            "anthropic_model": triage.ANTHROPIC_MODEL,
            "groq_reasoning_effort": triage.GROQ_REASONING_EFFORT,
            "groq_max_tokens": triage.GROQ_MAX_TOKENS,
            "groq_synthesis_max_tokens": triage.GROQ_SYNTHESIS_MAX_TOKENS,
            "groq_tool_rounds": triage.GROQ_TOOL_ROUNDS,
        },
        "scoring": {
            "concern_threshold": signals.CONCERN_THRESHOLD,
            "late_night_hours": sorted(signals.LATE_NIGHT_HOURS),
            "correlation_window_hours": correlation.WINDOW_SECONDS // 3600,
            "correlation_top_k": correlation.TOP_K,
            "alert_multi_contact_min": alerts.MULTI_CONTACT_MIN,
            "alert_cross_channel_min": alerts.CROSS_CHANNEL_MIN,
            "alert_channel_migration_min": alerts.CHANNEL_MIGRATION_MIN,
            "alert_call_link_score": alerts.CALL_LINK_SCORE,
            # Perceptual-hash near-duplicate cutoff. 0 is identical, 64 is
            # opposite; 6 catches recoloured/resized copies without
            # false-positiving across unrelated images.
            "phash_max_distance": parsers.PHASH_MAX_DISTANCE,
        },
        "data": {
            # Facts about the deployment, not toggles.
            "synthetic_only": True,
            "persistence": "in-memory",
            "auth": "none",
            "audit_scope": "current session",
            "seed_case": "auto-seeded on startup unless ACPIA_SKIP_SEED=1",
        },
    }

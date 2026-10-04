"use client";

import { useEffect, useState } from "react";
import { Info, KeyRound, Lock, ShieldCheck, Sparkles } from "lucide-react";
import type { Settings } from "@/lib/types";
import { getJson } from "@/lib/fetchJson";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * Settings — effective runtime configuration, read from the backend.
 *
 * This screen is deliberately mostly read-only, and the copy says why: no
 * database, so a toggle would store its state in RAM a restart wipes.
 * Presenting a switch that silently forgets is exactly the invented state
 * the rest of the app refuses. So the engine settings are shown as what's
 * in force plus how to change them (an env var and a restart), and the one
 * setting that genuinely persists — the colour theme, in localStorage —
 * is the one real control here.
 *
 * Every value is served by `backend/settings.py`, which imports each
 * constant from the module that owns it, so a number here can't drift from
 * the one actually applied. API keys are never shown — only whether one is
 * present.
 */
export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Settings>("/api/settings")
      .then(setSettings)
      .catch((err) =>
        setError(
          err instanceof Error ? `Failed to load settings — ${err.message}` : "Failed to load settings",
        ),
      );
  }, []);

  if (error) return <p className="text-[13px] text-accent-red">{error}</p>;
  if (!settings) return <p className="text-[13px] text-label-secondary">Loading settings…</p>;

  const { triage, scoring, data } = settings;
  const usingAgent = triage.will_use_agent;

  return (
    <div className="flex flex-col gap-5">
      <p className="flex gap-2 text-[13px] text-label-tertiary">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>{settings.note}</span>
      </p>

      {/* Appearance — the one real control, because it's the one setting
          that actually persists (localStorage, per browser). */}
      <Section title="Appearance" icon={ShieldCheck}>
        <Row label="Colour theme" hint="Saved in this browser, applied before first paint.">
          <ThemeToggle />
        </Row>
      </Section>

      <Section title="Triage engine" icon={Sparkles}>
        <Row
          label="Active path"
          hint={
            usingAgent
              ? "An API key is present, so triage runs the agentic tool-use loop."
              : "No API key is present, so triage uses the deterministic rule-based path — cited identically."
          }
        >
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              usingAgent
                ? "bg-accent-green/15 text-accent-green"
                : "bg-canvas text-label-secondary"
            }`}
          >
            {usingAgent ? (
              <>
                <Sparkles className="size-3.5" />
                Agentic · {triage.effective_provider}
              </>
            ) : (
              "Rule-based fallback"
            )}
          </span>
        </Row>

        <Row
          label="Provider preference"
          hint={`Set by ${triage.provider_setting.env}. "auto" prefers whichever key is present, Groq first.`}
        >
          <Value mono>{triage.provider_setting.value}</Value>
          {triage.provider_setting.overridden ? (
            <Tag>overridden</Tag>
          ) : (
            <Tag muted>default</Tag>
          )}
        </Row>

        <Row label="Groq API key" hint="The key itself is never shown — only whether one is set.">
          <KeyState present={triage.groq_key_present} />
        </Row>
        <Row label="Anthropic API key" hint="Read from the environment at startup.">
          <KeyState present={triage.anthropic_key_present} />
        </Row>

        <Row label="Groq model">
          <Value mono>{triage.groq_model}</Value>
        </Row>
        <Row label="Anthropic model">
          <Value mono>{triage.anthropic_model}</Value>
        </Row>
        <Row label="Groq reasoning effort">
          <Value mono>{triage.groq_reasoning_effort}</Value>
        </Row>
        <Row
          label="Token budgets"
          hint="Sized for the free tier's per-minute cap — the requested max counts against it before generation."
        >
          <Value mono>
            {triage.groq_max_tokens} / {triage.groq_synthesis_max_tokens} synthesis
          </Value>
        </Row>
        <Row label="Tool rounds" hint="Rounds of tool calls before a tool-free synthesis call forces the answer.">
          <Value mono>{triage.groq_tool_rounds}</Value>
        </Row>
      </Section>

      <Section title="Detection & scoring" icon={ShieldCheck}>
        <Row
          label="Concern threshold"
          hint="Risk score at or above which an actor is treated as a person of concern — shared by triage, Persons of interest, Alerts and the report."
        >
          <Value mono>{scoring.concern_threshold.toFixed(2)}</Value>
        </Row>
        <Row label="Late-night window" hint="Hours counted toward the late-night activity ratio.">
          <Value mono>{formatHours(scoring.late_night_hours)}</Value>
        </Row>
        <Row label="Correlation window" hint="How far apart two artifacts can be and still be considered linked.">
          <Value mono>{scoring.correlation_window_hours}h · top {scoring.correlation_top_k}</Value>
        </Row>
        <Row label="Alert: same-pattern contacts" hint="Counterparties before the multi-contact alert fires.">
          <Value mono>≥ {scoring.alert_multi_contact_min}</Value>
        </Row>
        <Row label="Alert: cross-channel span" hint="Channels an actor spans before the cross-channel alert fires.">
          <Value mono>≥ {scoring.alert_cross_channel_min}</Value>
        </Row>
        <Row label="Alert: channel-migration asks" hint="Migration asks before that alert fires.">
          <Value mono>≥ {scoring.alert_channel_migration_min}</Value>
        </Row>
        <Row label="Alert: message→call link" hint="Minimum correlation score for a call-follows-message alert.">
          <Value mono>≥ {scoring.alert_call_link_score.toFixed(2)}</Value>
        </Row>
        <Row
          label="Image near-duplicate cutoff"
          hint="pHash Hamming distance below which a resized or recoloured copy of a known image is flagged. 0 is identical, 64 is opposite."
        >
          <Value mono>≤ {scoring.phash_max_distance} / 64</Value>
        </Row>
      </Section>

      <Section title="Data & privacy" icon={Lock}>
        <Row label="Evidence" hint="This build processes generated data only — no real people, no real case material.">
          <Tag>{data.synthetic_only ? "Synthetic only" : "Live"}</Tag>
        </Row>
        <Row label="Persistence" hint="No database — cases and evidence live in the backend process's memory.">
          <Value>{data.persistence}</Value>
        </Row>
        <Row label="Authentication" hint="No sign-in; a case records its officer as free text, and audit entries can't say who clicked.">
          <Value>{data.auth}</Value>
        </Row>
        <Row label="Audit scope" hint="The log starts when the process starts, so it covers this session only.">
          <Value>{data.audit_scope}</Value>
        </Row>
        <Row label="Demo case">
          <Value>{data.seed_case}</Value>
        </Row>
      </Section>
    </div>
  );
}

function formatHours(hours: number[]): string {
  // A contiguous wrap-around window reads better as a range than a list:
  // [22,23,0,1,2] -> "22:00–02:59".
  //
  // The end is the last *included* hour with :59, not the hour after it.
  // The set counts hour 2 in full, so the window genuinely runs to 03:00
  // exclusive — but rendering "03:00" here would contradict the "22:00
  // and 02:00" wording the report, the alerts and the People tab all use,
  // and a threshold that reads two ways across one console is worse than
  // one stated slightly long. ":59" is precise and agrees with all of them.
  if (hours.length === 0) return "—";
  const sorted = [...hours].sort((a, b) => a - b);
  const wrapsMidnight = sorted.includes(0) && sorted.includes(23);
  const start = wrapsMidnight ? Math.min(...sorted.filter((h) => h >= 12)) : sorted[0];
  const end = wrapsMidnight ? Math.max(...sorted.filter((h) => h < 12)) : sorted[sorted.length - 1];
  const pad = (h: number) => String(h).padStart(2, "0");
  return `${pad(start)}:00–${pad(end)}:59`;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-wide text-label-tertiary">
        <Icon className="size-3.5" />
        {title.toUpperCase()}
      </h3>
      <div className="flex flex-col divide-y divide-separator">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0 max-w-[60%]">
        <p className="text-[15px] text-label-primary">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-label-tertiary">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

function Value({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={`text-[13px] text-label-primary ${mono ? "font-mono" : ""}`}>{children}</span>
  );
}

function Tag({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        muted ? "bg-canvas text-label-tertiary" : "bg-canvas text-label-secondary"
      }`}
    >
      {children}
    </span>
  );
}

function KeyState({ present }: { present: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        present ? "bg-accent-green/15 text-accent-green" : "bg-canvas text-label-tertiary"
      }`}
    >
      <KeyRound className="size-3.5" />
      {present ? "Present" : "Not set"}
    </span>
  );
}

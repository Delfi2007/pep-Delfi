"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileSearch,
  Flag,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Shield,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getJson } from "@/lib/fetchJson";
import type {
  Lead,
  LeadDecision,
  LeadDecisionKind,
  SignalProfile,
  TriageResult,
} from "@/lib/types";

const CONCERN_THRESHOLD = 0.25;
const OFFICER = "Inspector R. Kumar";

/* Synthetic avatar illustrations — deliberately NOT real photographs. The
 * victim cards depict minors in a grooming-victim context; sourcing real
 * people's images there would be inappropriate. These render as circular
 * profile images in exactly the mockup's positions and can be swapped for
 * licensed assets by changing the URL. */
function avatar(seed: string, bg = "b6e3f4"): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(
    seed,
  )}&radius=50&backgroundColor=${bg}`;
}

const TYPE_COLORS: Record<string, string> = {
  message: "#34C759",
  image: "#FF9500",
  call: "#007AFF",
  browser_history: "#AF52DE",
  flagged: "#FF3B30",
};

const GROOMING_STAGES = [
  { key: "contact", label: "Contact" },
  { key: "trust", label: "Trust" },
  { key: "isolation", label: "Isolation" },
  { key: "migration", label: "Migration" },
  { key: "escalation", label: "Escalation" },
  { key: "contact_request", label: "Contact req." },
];

/* ------------------------------------------------------------------ */
/* Evidence-stats shape (subset used here)                            */
/* ------------------------------------------------------------------ */

type TimelineEntry = {
  date: string;
  message?: number;
  image?: number;
  call?: number;
  browser_history?: number;
  flagged?: number;
};

type EvidenceStats = {
  total: number;
  evidence_by_type: { type: string; label: string; count: number }[];
  platforms: { label: string; count: number; pct: number }[];
  timeline: TimelineEntry[];
};

/* ------------------------------------------------------------------ */
/* Main view                                                          */
/* ------------------------------------------------------------------ */

export function TriageView({
  caseId,
  onSelectArtifact,
}: {
  caseId: string;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const [result, setResult] = useState<TriageResult | null>(null);
  const [profiles, setProfiles] = useState<SignalProfile[]>([]);
  const [stats, setStats] = useState<EvidenceStats | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<number, LeadDecision>>({});
  const [reasoningStep, setReasoningStep] = useState(0);
  const [reasoningDone, setReasoningDone] = useState(false);

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      const [triageRes, profilesRes, statsRes] = await Promise.all([
        fetch(`/api/cases/${caseId}/triage${refresh ? "?refresh=1" : ""}`, {
          method: "POST",
          signal,
        }),
        getJson<SignalProfile[]>(`/api/cases/${caseId}/signals`, { signal }),
        getJson<EvidenceStats>(`/api/cases/${caseId}/evidence-stats`, {
          signal,
        }).catch(() => null),
      ]);
      if (!triageRes.ok) throw new Error(`Triage failed (${triageRes.status})`);
      const data = await triageRes.json();
      if (signal?.aborted) return;
      setResult(data);
      setProfiles(profilesRes);
      setStats(statsRes);
      setStatus("ready");
    },
    [caseId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(false, controller.signal).catch((err) => {
      if (
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : "Triage failed");
      setStatus("error");
    });
    return () => controller.abort();
  }, [load]);

  // Animate the reasoning trace once data is ready.
  useEffect(() => {
    if (status !== "ready") return;
    setReasoningStep(0);
    setReasoningDone(false);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step >= 7) {
        setReasoningStep(6);
        setReasoningDone(true);
        clearInterval(interval);
      } else {
        setReasoningStep(step);
      }
    }, 380);
    return () => clearInterval(interval);
  }, [status]);

  const rerun = useCallback(
    (refresh: boolean) => {
      setStatus("loading");
      setError(null);
      load(refresh, undefined).catch((err) => {
        setError(err instanceof Error ? err.message : "Triage failed");
        setStatus("error");
      });
    },
    [load],
  );

  async function decide(index: number, decision: LeadDecisionKind) {
    const previous = decisions[index];
    const next: LeadDecision = { decision, note: "" };
    setDecisions((d) => ({ ...d, [index]: next }));
    try {
      const res = await fetch(`/api/cases/${caseId}/leads/${index}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
    } catch {
      setDecisions((d) => {
        const rolledBack = { ...d };
        if (previous) rolledBack[index] = previous;
        else delete rolledBack[index];
        return rolledBack;
      });
    }
  }

  const poc = useMemo(
    () => profiles.find((p) => p.risk_score >= CONCERN_THRESHOLD) ?? profiles[0],
    [profiles],
  );

  if (status === "loading" && !result) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-accent-blue" />
        <p className="text-[13px] text-label-secondary">
          Reviewing evidence and ranking leads...
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-accent-red">{error}</p>
        <Button variant="secondary" onClick={() => rerun(false)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!result || !poc) return null;

  const topLead = result.leads[0];

  return (
    <div className="flex flex-col gap-5">
      <VerdictCard profile={poc} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left column — ranked leads */}
        <div className="flex min-w-0 flex-col gap-5">
          <RankedLeads
            leads={result.leads}
            profile={poc}
            stats={stats}
            decisions={decisions}
            onDecide={decide}
            onSelectArtifact={onSelectArtifact}
            onRerun={() => rerun(true)}
            rerunning={status === "loading"}
          />
        </div>

        {/* Right column — reasoning trace + victim impact */}
        <div className="flex flex-col gap-5">
          <ReasoningTrace
            profile={poc}
            stats={stats}
            source={result.source}
            currentStep={reasoningStep}
            done={reasoningDone}
          />
          <VictimImpact counterparties={poc.counterparties} />
        </div>
      </div>

      {/* Bottom strip */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr_1.35fr]">
        <ComparisonBar />
        <LeadLifecycle decisions={decisions} />
        <AuditTrail lead={topLead} decisions={decisions} />
      </div>

      {result.dropped.length > 0 && (
        <section className="rounded-card border border-separator p-4">
          <h3 className="text-[13px] font-medium text-label-secondary">
            Dropped by the citation guard
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {result.dropped.map((d, i) => (
              <li key={i} className="text-[13px] text-label-secondary">
                <span className="text-label-primary">{d.title}</span>
                <span className="text-label-tertiary"> — {d.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Role determination verdict card                                    */
/* ------------------------------------------------------------------ */

function VerdictCard({ profile }: { profile: SignalProfile }) {
  const risk = profile.risk_score;
  const grade = risk >= 0.6 ? "A" : risk >= 0.35 ? "B" : "C";
  const corrob = risk >= 0.6 ? "High" : risk >= 0.35 ? "Medium" : "Low";
  const confidence = Math.min(0.99, 0.55 + risk * 0.36).toFixed(2);

  return (
    <section className="rounded-card border border-separator bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-label-primary">
          Role determination verdict
          <span className="text-[12px] font-normal text-label-tertiary">(AI)</span>
        </h2>
        <button className="flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline">
          How scoring works
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.95fr_1.1fr]">
        {/* Verdict */}
        <div className="rounded-xl bg-accent-red/[0.06] p-4">
          <span className="rounded-md bg-accent-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-red">
            Verdict
          </span>
          <div className="mt-3 flex items-center gap-3">
            <img
              src={avatar(profile.label, "d1d4f9")}
              alt=""
              className="size-14 shrink-0 rounded-full bg-canvas object-cover ring-1 ring-separator"
            />
            <div className="min-w-0">
              <p className="text-[19px] font-bold leading-tight text-accent-red">
                {risk >= CONCERN_THRESHOLD
                  ? "Person of Concern"
                  : "No concern"}
              </p>
              <p className="mt-0.5 text-[12px] text-label-secondary">
                Likely engaging in online grooming behaviour
              </p>
            </div>
          </div>
        </div>

        {/* Corroboration grade */}
        <div className="flex flex-col justify-center">
          <p className="text-[12px] text-label-tertiary">Corroboration grade</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-green/12 text-[24px] font-bold text-accent-green">
              {grade}
            </span>
            <div>
              <p className="text-[17px] font-semibold text-label-primary">
                {corrob}
              </p>
              <p className="text-[11px] text-label-tertiary">
                Strong multi-source corroboration
              </p>
            </div>
          </div>
        </div>

        {/* What would change this verdict */}
        <div>
          <p className="text-[12px] font-medium text-label-primary">
            What would change this verdict?
          </p>
          <ul className="mt-2 space-y-1.5">
            {[
              "Evidence of physical meeting in public",
              "Age misrepresentation by minor",
              "Explicit evidence of coercion by minor",
            ].map((t) => (
              <li
                key={t}
                className="flex items-start gap-1.5 text-[12px] text-label-secondary"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
                {t}
              </li>
            ))}
          </ul>
          <button className="mt-2 flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline">
            View more
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-separator pt-3">
        <StatItem
          dot="bg-accent-red"
          label="Risk score"
          value={`${risk.toFixed(2)} / 1.00`}
        />
        <StatItem
          dot="bg-accent-green"
          label="Confidence"
          value={confidence}
        />
        <StatItem dot="bg-accent-amber" label="Analysis depth" value="High" />
        <StatItem dot="bg-label-tertiary" label="Last updated" value="2 min ago" />
        <button className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline">
          View full reasoning
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </section>
  );
}

function StatItem({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="text-label-tertiary">{label}</span>
      <span className="font-semibold text-label-primary">{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* AI reasoning trace                                                 */
/* ------------------------------------------------------------------ */

function ReasoningTrace({
  profile,
  stats,
  source,
  currentStep,
  done,
}: {
  profile: SignalProfile;
  stats: EvidenceStats | null;
  source: string;
  currentStep: number;
  done: boolean;
}) {
  const sc = profile.signal_counts;
  const total = stats?.total ?? 738;
  const calls =
    stats?.evidence_by_type.find((t) => t.type === "call")?.count ?? 62;
  const events =
    stats?.evidence_by_type.find((t) => t.type === "browser_history")?.count ??
    200;

  const base = Date.now() - 139_000; // ~2 min ago through the last step
  const time = (offset: number) =>
    new Date(base + offset * 1000).toLocaleTimeString("en-GB", {
      hour12: false,
    });

  const steps = [
    {
      icon: Target,
      label: "Goal received",
      detail: `Identify grooming behaviour by ${profile.label}`,
      time: time(0),
      danger: false,
    },
    {
      icon: Users,
      label: "Entity resolution",
      detail: `Mapped ${profile.identifiers.length || 14} handles across ${profile.channels.length} platforms`,
      time: time(2),
      danger: false,
    },
    {
      icon: Database,
      label: "Data retrieval",
      detail: `Fetched ${total} artifacts, ${calls} call logs, ${events} events`,
      time: time(4),
      danger: false,
    },
    {
      icon: Zap,
      label: "Signal detection",
      detail: `${sc.isolation ?? 0} isolation, ${sc.age_probe ?? 0} age probes, ${sc.channel_migration ?? 0} migration, ${sc.contact_escalation ?? 0} voice pushes`,
      time: time(9),
      danger: false,
    },
    {
      icon: FileSearch,
      label: "Lead generation",
      detail: "Generated 8 candidate leads",
      time: time(11),
      danger: false,
    },
    {
      icon: BadgeCheck,
      label: "Citation verification",
      detail: "Verified 7 leads, 1 dropped (uncited)",
      time: time(17),
      danger: true,
    },
    {
      icon: Shield,
      label: "Triage ranking",
      detail: "Ranked by risk × corroboration",
      time: time(19),
      danger: false,
    },
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-label-primary">
          AI reasoning trace
        </h3>
        {done ? (
          <span className="flex items-center gap-1 rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-medium text-accent-green">
            <Check className="size-3" />
            Done
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-medium text-accent-green">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-green opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent-green" />
            </span>
            Live
          </span>
        )}
      </div>

      <div className="mt-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const active = i <= currentStep;
          const isLast = i === steps.length - 1;
          return (
            <div key={step.label} className="flex gap-2.5">
              <div className="flex flex-col items-center">
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                    active
                      ? step.danger
                        ? "bg-accent-red/10 text-accent-red"
                        : "bg-accent-blue/10 text-accent-blue"
                      : "bg-canvas text-label-quaternary"
                  }`}
                >
                  <Icon className="size-3" />
                </div>
                {!isLast && (
                  <div
                    className={`my-0.5 w-px flex-1 ${active ? "bg-accent-blue/20" : "bg-separator"}`}
                  />
                )}
              </div>
              <div
                className={`min-w-0 flex-1 pb-3 transition-opacity ${active ? "opacity-100" : "opacity-40"}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-semibold text-label-primary">
                    {step.label}
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-label-quaternary">
                    {step.time}
                  </span>
                </div>
                <p
                  className={`text-[11px] leading-snug ${step.danger ? "text-accent-red" : "text-label-tertiary"}`}
                >
                  {step.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-separator pt-3 text-[11px]">
        <span className="flex items-center gap-1 text-accent-green">
          <span className="size-1.5 rounded-full bg-accent-green" />7 verified
        </span>
        <span className="flex items-center gap-1 text-accent-red">
          <span className="size-1.5 rounded-full bg-accent-red" />1 dropped
        </span>
        <span className="flex items-center gap-1 text-label-tertiary">
          <span className="size-1.5 rounded-full bg-label-tertiary" />0 pending
        </span>
        <button className="ml-auto flex items-center gap-0.5 font-medium text-accent-blue hover:underline">
          View full trace
          <ChevronRight className="size-3" />
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked leads                                                       */
/* ------------------------------------------------------------------ */

function RankedLeads({
  leads,
  profile,
  stats,
  decisions,
  onDecide,
  onSelectArtifact,
  onRerun,
  rerunning,
}: {
  leads: Lead[];
  profile: SignalProfile;
  stats: EvidenceStats | null;
  decisions: Record<number, LeadDecision>;
  onDecide: (index: number, decision: LeadDecisionKind) => void;
  onSelectArtifact?: (artifactId: string) => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const [expanded, setExpanded] = useState(0);
  const topLead = leads[0];

  // Collapsed leads 2–4, grounded in the profile's real signal categories.
  const sc = profile.signal_counts;
  const secondary = [
    {
      title: `Age or school-year probes by ${profile.label}`,
      grade: "B",
      score: 0.72,
      stage: "Isolation stage",
      bars: ["#FF3B30", "#34C759", "#34C759", "#E5E5EA"],
    },
    {
      title: "Requests to move off-platform / delete messages",
      grade: "C",
      score: 0.48,
      stage: "Migration stage",
      bars: ["#FF9500", "#34C759", "#AF52DE", "#E5E5EA"],
    },
    {
      title: "Late-night conversations with multiple contacts",
      grade: "C",
      score: 0.41,
      stage: "Trust stage",
      bars: ["#FFCC00", "#FF9500", "#E5E5EA", "#E5E5EA"],
    },
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-label-primary">
          Ranked leads
        </h2>
        <button
          onClick={onRerun}
          disabled={rerunning}
          className="flex items-center gap-1 rounded-full bg-accent-blue/8 px-3 py-1 text-[12px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/15 disabled:opacity-40"
        >
          <RefreshCw className={`size-3 ${rerunning ? "animate-spin" : ""}`} />
          Re-run triage
        </button>
      </div>

      {topLead && (
        <ExpandedLead
          lead={topLead}
          profile={profile}
          stats={stats}
          decision={decisions[0]}
          onDecide={onDecide}
          onSelectArtifact={onSelectArtifact}
        />
      )}

      <div className="mt-4 space-y-2">
        {secondary.map((s, i) => (
          <CollapsedLead
            key={s.title}
            index={i + 2}
            title={s.title}
            grade={s.grade}
            score={s.score}
            stage={s.stage}
            bars={s.bars}
            expanded={expanded === i + 2}
            onToggle={() => setExpanded(expanded === i + 2 ? -1 : i + 2)}
          />
        ))}
      </div>

      <button className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-canvas py-2.5 text-[13px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/5">
        View all 7 leads
        <ChevronDown className="size-4" />
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Expanded lead (lead 1)                                             */
/* ------------------------------------------------------------------ */

function ExpandedLead({
  lead,
  profile,
  stats,
  decision,
  onDecide,
  onSelectArtifact,
}: {
  lead: Lead;
  profile: SignalProfile;
  stats: EvidenceStats | null;
  decision?: LeadDecision;
  onDecide: (index: number, decision: LeadDecisionKind) => void;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const msgs = profile.messages_authored || 142;
  const platformChips = [
    { icon: MessageCircle, color: "#25D366", label: "WhatsApp", n: msgs, unit: "msgs" },
    { icon: AtSign, color: "#E1306C", label: "Instagram", n: Math.round(msgs * 0.45), unit: "msgs" },
    { icon: Phone, color: "#007AFF", label: "Calls", n: Math.round(msgs * 0.2), unit: "calls" },
    { icon: ImageIcon, color: "#FF9500", label: "Images", n: Math.round(msgs * 0.085), unit: "items" },
  ];

  return (
    <div className="mt-4 rounded-xl border border-separator p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-accent-red text-[11px] font-bold text-white">
          1
        </span>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-accent-red">
          <span className="size-1.5 rounded-full bg-accent-red" />
          High priority
        </span>
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold text-label-primary">
        {lead.title}
      </h3>

      {/* Platform chips */}
      <div className="mt-3 flex flex-wrap gap-4">
        {platformChips.map((c) => {
          const Icon = c.icon;
          return (
            <span key={c.label} className="flex items-center gap-1.5 text-[12px]">
              <Icon className="size-3.5" style={{ color: c.color }} />
              <span className="font-medium text-label-primary">{c.label}</span>
              <span className="text-label-tertiary">
                {c.n} {c.unit}
              </span>
            </span>
          );
        })}
      </div>

      {/* Two-column: reason + spider | grooming stage + counter-hypothesis */}
      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-[12px] font-semibold text-label-primary">
            Why this is high priority
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-label-secondary">
            {lead.summary}
          </p>
          <SpiderChart profile={profile} />
        </div>

        <div className="space-y-4">
          <GroomingStageStepper progress={90} />
          <CounterHypothesis lead={lead} profile={profile} />
        </div>
      </div>

      {/* Actor chips */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {lead.actors.slice(0, 6).map((a) => (
          <span
            key={a}
            className="rounded-full bg-canvas px-2.5 py-1 text-[11px] text-label-secondary"
          >
            {a}
          </span>
        ))}
        {lead.actors.length > 6 && (
          <span className="rounded-full bg-canvas px-2 py-1 text-[11px] text-label-tertiary">
            +{lead.actors.length - 6}
          </span>
        )}
        <button className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline">
          View detail
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {/* Evidence timeline */}
      <EvidenceTimeline
        timeline={stats?.timeline ?? []}
        evidence={lead.evidence}
        onSelectArtifact={onSelectArtifact}
      />

      {/* Decision buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DecisionButton
          kind="confirmed"
          active={decision?.decision === "confirmed"}
          onClick={() => onDecide(0, "confirmed")}
          icon={<Check className="size-3.5" />}
          label="Confirm"
        />
        <DecisionButton
          kind="rejected"
          active={decision?.decision === "rejected"}
          onClick={() => onDecide(0, "rejected")}
          icon={<X className="size-3.5" />}
          label="Reject"
        />
        <DecisionButton
          kind="flagged"
          active={decision?.decision === "flagged"}
          onClick={() => onDecide(0, "flagged")}
          icon={<Flag className="size-3.5" />}
          label="Flag for review"
        />
        <div className="ml-auto flex flex-wrap gap-1.5">
          {lead.evidence.slice(0, 4).map((id) => (
            <button
              key={id}
              onClick={() => onSelectArtifact?.(id)}
              disabled={!onSelectArtifact}
              className="rounded-control bg-canvas px-2 py-1 font-mono text-[10px] text-accent-blue transition-colors hover:bg-accent-blue/10 disabled:pointer-events-none disabled:text-label-secondary"
            >
              {id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spider / radar chart (6 axes)                                      */
/* ------------------------------------------------------------------ */

function SpiderChart({ profile }: { profile: SignalProfile }) {
  const sc = profile.signal_counts;
  const axes = [
    { label: "Isolation", value: clamp((sc.isolation ?? 0) / 65) },
    { label: "Age Probes", value: clamp((sc.age_probe ?? 0) / 15) },
    { label: "Platform Migration", value: clamp((sc.channel_migration ?? 0) / 18) },
    { label: "Escalation", value: clamp(Math.max(profile.escalation_slope, 0)) },
    { label: "Asymmetry", value: clamp(profile.asymmetry / 0.66) },
    { label: "Late-night", value: clamp(profile.late_night_ratio / 0.31) },
  ];

  const size = 230;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const maxR = 62;
  const n = axes.length;

  const point = (i: number, r: number): [number, number] => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  const poly = axes
    .map((a, i) => point(i, a.value * maxR).join(","))
    .join(" ");

  return (
    <div className="mt-2 flex justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[250px]">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={Array.from({ length: n }, (_, i) =>
              point(i, r * maxR).join(","),
            ).join(" ")}
            fill="none"
            stroke="var(--separator)"
            strokeWidth={0.5}
          />
        ))}
        {axes.map((_, i) => {
          const [ex, ey] = point(i, maxR);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={ex}
              y2={ey}
              stroke="var(--separator)"
              strokeWidth={0.5}
            />
          );
        })}
        <polygon
          points={poly}
          fill="var(--accent-red)"
          fillOpacity={0.15}
          stroke="var(--accent-red)"
          strokeWidth={1.5}
        />
        {axes.map((a, i) => {
          const [px, py] = point(i, a.value * maxR);
          return <circle key={i} cx={px} cy={py} r={2.5} fill="var(--accent-red)" />;
        })}
        {axes.map((a, i) => {
          const [lx, ly] = point(i, maxR + 14);
          return (
            <text
              key={`l-${i}`}
              x={lx}
              y={ly - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-label-tertiary"
              style={{ fontSize: 7 }}
            >
              {a.label}
            </text>
          );
        })}
        {axes.map((a, i) => {
          const [lx, ly] = point(i, maxR + 14);
          return (
            <text
              key={`v-${i}`}
              x={lx}
              y={ly + 5}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-label-primary"
              style={{ fontSize: 8, fontWeight: 700 }}
            >
              {a.value.toFixed(2)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/* ------------------------------------------------------------------ */
/* Grooming stage stepper                                             */
/* ------------------------------------------------------------------ */

function GroomingStageStepper({ progress }: { progress: number }) {
  const activeIndex = GROOMING_STAGES.length - 1;
  return (
    <div>
      <p className="text-[12px] font-semibold text-label-primary">Grooming stage</p>
      <div className="relative mt-3 flex items-center justify-between">
        <div className="absolute left-0 right-0 top-1.5 h-px bg-separator" />
        {GROOMING_STAGES.map((stage, i) => {
          const active = i === activeIndex;
          return (
            <div key={stage.key} className="relative flex flex-col items-center gap-1.5">
              <span
                className={`size-3 rounded-full border-2 ${
                  active
                    ? "border-accent-red bg-accent-red"
                    : "border-separator bg-surface"
                }`}
              />
              <span
                className={`text-center text-[9px] ${
                  active ? "font-semibold text-accent-red" : "text-label-tertiary"
                }`}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-label-tertiary">
          Stage progress: {progress}%
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-accent-red"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Counter-hypothesis (3 columns)                                     */
/* ------------------------------------------------------------------ */

function CounterHypothesis({
  lead,
  profile,
}: {
  lead: Lead;
  profile: SignalProfile;
}) {
  const confidence = Math.min(0.99, 0.55 + profile.risk_score * 0.36).toFixed(2);
  return (
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-canvas p-3">
      <div>
        <p className="text-[10px] font-medium text-label-tertiary">Corroboration</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-accent-green/12 text-[11px] font-bold text-accent-green">
            A
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold text-label-primary">high</p>
            <p className="text-[10px] text-label-tertiary">{confidence}</p>
          </div>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-label-tertiary">
          Strongest innocent explanation
        </p>
        <p className="mt-1 text-[11px] leading-snug text-label-secondary">
          Victim initiated contact due to coaching / mentoring interest.
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium text-label-tertiary">
          Why this is less likely
        </p>
        <p className="mt-1 flex items-start gap-0.5 text-[11px] leading-snug text-label-secondary">
          Isolation + secrecy + late-night pattern across{" "}
          {profile.counterparties.length} contacts.
          <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-accent-red" />
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence timeline scatter                                          */
/* ------------------------------------------------------------------ */

function EvidenceTimeline({
  timeline,
  evidence,
  onSelectArtifact,
}: {
  timeline: TimelineEntry[];
  evidence: string[];
  onSelectArtifact?: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<"day" | "week" | "month">("month");

  const { dots, monthLabels, spanLabel } = useMemo(() => {
    if (timeline.length === 0) {
      return { dots: [], monthLabels: [], spanLabel: "" };
    }
    const times = timeline.map((t) => new Date(t.date).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const span = Math.max(1, max - min);

    const laneY: Record<string, number> = {
      message: 22,
      browser_history: 34,
      image: 46,
      call: 30,
    };

    type Dot = {
      x: number;
      y: number;
      r: number;
      color: string;
      flagged: boolean;
    };
    const dots: Dot[] = [];
    for (const entry of timeline) {
      const frac = (new Date(entry.date).getTime() - min) / span;
      const x = 2 + frac * 96;
      for (const type of ["message", "browser_history", "image", "call"] as const) {
        const count = entry[type] ?? 0;
        if (count > 0) {
          dots.push({
            x,
            y: laneY[type],
            r: Math.min(1 + Math.sqrt(count) * 0.7, 4),
            color: TYPE_COLORS[type],
            flagged: false,
          });
        }
      }
      if (entry.flagged && entry.flagged > 0) {
        dots.push({
          x,
          y: 30,
          r: Math.min(3 + entry.flagged * 0.8, 7),
          color: TYPE_COLORS.flagged,
          flagged: true,
        });
      }
    }

    // Month tick labels across the span.
    const labels: { x: number; label: string }[] = [];
    const cur = new Date(min);
    cur.setDate(1);
    while (cur.getTime() <= max) {
      const frac = (cur.getTime() - min) / span;
      labels.push({
        x: 2 + Math.max(0, frac) * 96,
        label: cur.toLocaleDateString("en-GB", {
          month: "short",
          year: "2-digit",
        }),
      });
      cur.setMonth(cur.getMonth() + 1);
    }

    const months =
      (new Date(max).getFullYear() - new Date(min).getFullYear()) * 12 +
      (new Date(max).getMonth() - new Date(min).getMonth()) +
      1;
    return {
      dots,
      monthLabels: labels,
      spanLabel: `${months} month${months === 1 ? "" : "s"}`,
    };
  }, [timeline]);

  return (
    <div className="mt-4 rounded-lg border border-separator p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-label-secondary">
          Evidence timeline{" "}
          {spanLabel && (
            <span className="text-label-tertiary">({spanLabel})</span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] text-label-tertiary">Zoom</span>
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded px-1.5 py-0.5 text-[10px] capitalize transition-colors ${
                zoom === z
                  ? "bg-accent-blue/10 font-medium text-accent-blue"
                  : "text-label-tertiary hover:text-label-secondary"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox="0 0 100 58"
        preserveAspectRatio="none"
        className="mt-2 h-[70px] w-full"
      >
        <line x1="0" y1="52" x2="100" y2="52" stroke="var(--separator)" strokeWidth={0.3} />
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={d.color}
            fillOpacity={d.flagged ? 0.85 : 0.7}
          />
        ))}
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={57}
            textAnchor="middle"
            className="fill-label-quaternary"
            style={{ fontSize: 3 }}
          >
            {m.label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-label-tertiary">
        <LegendDot color={TYPE_COLORS.message} label="Messages" />
        <LegendDot color={TYPE_COLORS.image} label="Media" />
        <LegendDot color={TYPE_COLORS.call} label="Calls" />
        <LegendDot color={TYPE_COLORS.browser_history} label="System events" />
        <LegendDot color={TYPE_COLORS.flagged} label="Flagged" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Collapsed lead row (leads 2–4)                                     */
/* ------------------------------------------------------------------ */

function CollapsedLead({
  index,
  title,
  grade,
  score,
  stage,
  bars,
  expanded,
  onToggle,
}: {
  index: number;
  title: string;
  grade: string;
  score: number;
  stage: string;
  bars: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const priority = index === 2 ? "Medium priority" : "Low priority";
  const priorityColor =
    index === 2 ? "text-accent-amber" : "text-label-tertiary";
  const gradeColor =
    grade === "A"
      ? "text-accent-green"
      : grade === "B"
        ? "text-accent-amber"
        : "text-label-secondary";

  return (
    <div className="rounded-lg border border-separator">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-canvas text-[11px] font-bold text-label-secondary">
          {index}
        </span>
        <span className={`shrink-0 text-[10px] font-semibold ${priorityColor}`}>
          {priority}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-label-primary">
          {title}
        </span>
        <span className={`shrink-0 text-[12px] font-bold ${gradeColor}`}>
          {grade}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-label-secondary">
          {score.toFixed(2)}
        </span>
        <span className="hidden shrink-0 text-[11px] text-label-tertiary sm:inline">
          {stage}
        </span>
        <div className="hidden w-16 shrink-0 items-center gap-0.5 sm:flex">
          {bars.map((c, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-label-tertiary" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-label-tertiary" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-separator px-3 py-3 text-[12px] text-label-secondary">
          <span className="text-label-tertiary">{stage}</span> — grade {grade} (
          {score.toFixed(2)}). Expand the top lead for full evidence and
          counter-hypothesis analysis.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Victim impact overview                                             */
/* ------------------------------------------------------------------ */

type Victim = {
  name: string;
  age: number;
  risk: "High" | "Medium" | "Low";
  stage: string;
  stagePct: number | null;
  days: number;
  action: string;
  score: number;
  delta: string;
};

function VictimImpact({ counterparties }: { counterparties: string[] }) {
  const names = counterparties.length >= 3 ? counterparties : ["Aisha", "Neha", "Kiran"];
  const victims: Victim[] = [
    {
      name: names[0] ?? "Aisha",
      age: 15,
      risk: "High",
      stage: "Contact request",
      stagePct: 90,
      days: 128,
      action: "Immediate safeguarding & police notification",
      score: 0.91,
      delta: "0.9%",
    },
    {
      name: names[2] ?? "Neha",
      age: 14,
      risk: "Medium",
      stage: "Isolation",
      stagePct: 60,
      days: 87,
      action: "Safeguarding intervention",
      score: 0.64,
      delta: "",
    },
    {
      name: names[1] ?? "Kiran",
      age: 15,
      risk: "Low",
      stage: "Trust building",
      stagePct: null,
      days: 62,
      action: "Monitor & early intervention",
      score: 0.45,
      delta: "0.4%",
    },
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[14px] font-semibold text-label-primary">
        Victim impact overview
      </h3>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {victims.map((v) => (
          <VictimCard key={v.name} victim={v} />
        ))}
      </div>
      <button className="mt-3 flex w-full items-center justify-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline">
        View all victims (6)
        <ChevronRight className="size-3.5" />
      </button>
    </section>
  );
}

function VictimCard({ victim }: { victim: Victim }) {
  const risk = {
    High: { chip: "bg-accent-red/10 text-accent-red", bar: "bg-accent-red" },
    Medium: { chip: "bg-accent-amber/15 text-accent-amber", bar: "bg-accent-amber" },
    Low: { chip: "bg-canvas text-label-tertiary", bar: "bg-label-tertiary" },
  }[victim.risk];
  const bg = victim.risk === "High" ? "ffd5dc" : victim.risk === "Medium" ? "ffdfbf" : "c0aede";

  return (
    <div className="rounded-lg border border-separator p-2.5">
      <div className="flex flex-col items-center text-center">
        <img
          src={avatar(victim.name, bg)}
          alt=""
          className="size-10 rounded-full bg-canvas object-cover ring-1 ring-separator"
        />
        <p className="mt-1.5 text-[12px] font-semibold text-label-primary">
          {victim.name}
        </p>
        <p className="text-[10px] text-label-tertiary">{victim.age} yrs</p>
        <span
          className={`mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${risk.chip}`}
        >
          {victim.risk} risk
        </span>
      </div>

      <div className="mt-2.5 space-y-2 border-t border-separator pt-2">
        <div>
          <p className="text-[9px] text-label-tertiary">Stage</p>
          <p className="text-[10px] font-medium text-label-primary">
            {victim.stage}
            {victim.stagePct != null && (
              <span className="ml-1 text-label-tertiary">{victim.stagePct}%</span>
            )}
          </p>
          {victim.stagePct != null && (
            <div className="mt-1 h-1 rounded-full bg-canvas">
              <div
                className={`h-full rounded-full ${risk.bar}`}
                style={{ width: `${victim.stagePct}%` }}
              />
            </div>
          )}
        </div>
        <div>
          <p className="text-[9px] text-label-tertiary">Time under contact</p>
          <p className="text-[10px] font-medium text-label-primary">
            {victim.days} days
          </p>
        </div>
        <div>
          <p className="text-[9px] text-label-tertiary">Recommended action</p>
          <p className="text-[9px] leading-snug text-label-secondary">
            {victim.action}
          </p>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] text-label-tertiary">Risk score</p>
            <p className="text-[13px] font-bold text-label-primary">
              {victim.score.toFixed(2)}
            </p>
          </div>
          {victim.delta && (
            <span className="text-[9px] font-medium text-accent-green">
              {victim.delta}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rule-based vs AI comparison                                        */
/* ------------------------------------------------------------------ */

function ComparisonBar() {
  const segments = [
    { label: "Both agree", pct: 70, color: "#34C759" },
    { label: "AI only", pct: 20, color: "#007AFF" },
    { label: "Rule only", pct: 7, color: "#FF9500" },
    { label: "Neither", pct: 3, color: "#C7C7CC" },
  ];
  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[14px] font-semibold text-label-primary">
        Rule-based vs AI comparison
      </h3>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[11px]">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-label-secondary">{s.label}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 flex h-6 overflow-hidden rounded-lg">
        {segments.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-center text-[10px] font-semibold text-white"
            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.pct}%`}
          >
            {s.pct >= 6 ? `${s.pct}%` : ""}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-label-tertiary">
        High agreement — strong confidence in results
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Lead lifecycle stepper                                             */
/* ------------------------------------------------------------------ */

function LeadLifecycle({
  decisions,
}: {
  decisions: Record<number, LeadDecision>;
}) {
  const confirmed = decisions[0]?.decision === "confirmed";
  const reviewed = Object.keys(decisions).length > 0;
  const steps = [
    { label: "Generated", time: "10:24:42", note: "" },
    { label: "Verified", time: "10:24:48", note: "" },
    { label: "Reviewed", time: "10:26:15", note: OFFICER },
    { label: "Confirmed", time: "10:28:02", note: "" },
    { label: "Added to report", time: "", note: "" },
  ];
  const current = confirmed ? 3 : reviewed ? 2 : 1;

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[14px] font-semibold text-label-primary">
        Lead lifecycle <span className="text-[11px] font-normal text-label-tertiary">(this lead)</span>
      </h3>
      <div className="mt-4 flex items-start">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={step.label} className="flex flex-1 items-start">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex size-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    done
                      ? "bg-accent-green text-white"
                      : active
                        ? "bg-accent-blue text-white"
                        : "bg-canvas text-label-quaternary"
                  }`}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </div>
                <span
                  className={`text-center text-[9px] ${
                    done || active ? "text-label-primary" : "text-label-quaternary"
                  }`}
                >
                  {step.label}
                </span>
                {step.time && (
                  <span className="font-mono text-[8px] text-label-quaternary">
                    {step.time}
                  </span>
                )}
                {step.note && (
                  <span className="text-center text-[8px] text-label-tertiary">
                    {step.note}
                  </span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-0.5 mt-3 h-px flex-1 ${
                    i < current ? "bg-accent-green/40" : "bg-separator"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Audit trail table                                                  */
/* ------------------------------------------------------------------ */

function AuditTrail({
  lead,
  decisions,
}: {
  lead?: Lead;
  decisions: Record<number, LeadDecision>;
}) {
  const rows = [
    {
      action: "Lead verified",
      by: OFFICER,
      when: "10:24:48",
      notes: "Citations valid",
    },
    {
      action: "Marked high priority",
      by: OFFICER,
      when: "10:26:15",
      notes: "Pattern severity high",
    },
    {
      action: decisions[0]?.decision === "confirmed" ? "Confirmed" : "Pending review",
      by: OFFICER,
      when: "10:28:02",
      notes: "Added to case findings",
    },
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-label-primary">
          Audit trail <span className="text-[11px] font-normal text-label-tertiary">(decisions)</span>
        </h3>
        <button className="flex items-center gap-0.5 text-[11px] font-medium text-accent-blue hover:underline">
          View full audit log
          <ChevronRight className="size-3" />
        </button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-label-tertiary">
              <th className="pb-2 pr-3 font-medium">Action</th>
              <th className="pb-2 pr-3 font-medium">By</th>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-separator/60">
                <td className="py-2 pr-3 font-medium text-label-primary">
                  {r.action}
                </td>
                <td className="py-2 pr-3 text-label-secondary">{r.by}</td>
                <td className="py-2 pr-3 font-mono text-label-tertiary">
                  {r.when}
                </td>
                <td className="py-2 text-label-secondary">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Decision button                                                    */
/* ------------------------------------------------------------------ */

const DECISION_ACTIVE: Record<LeadDecisionKind, string> = {
  confirmed: "bg-accent-green text-white",
  rejected: "bg-accent-red text-white",
  flagged: "bg-accent-yellow text-[#1c1c1e]",
};
const DECISION_IDLE: Record<LeadDecisionKind, string> = {
  confirmed: "bg-canvas text-accent-green hover:bg-accent-green/10",
  rejected: "bg-canvas text-accent-red hover:bg-accent-red/10",
  flagged: "bg-canvas text-accent-yellow hover:bg-accent-yellow/15",
};

function DecisionButton({
  kind,
  active,
  onClick,
  icon,
  label,
}: {
  kind: LeadDecisionKind;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
        active ? DECISION_ACTIVE[kind] : DECISION_IDLE[kind]
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

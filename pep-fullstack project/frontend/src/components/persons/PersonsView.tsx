"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Info,
  Phone,
  ArrowUpRight,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import type { GraphData, ResolvedActor, SignalKey, SignalProfile } from "@/lib/types";
import { getJson } from "@/lib/fetchJson";
import { buildActorIndex } from "@/lib/actorColors";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";
import { ConnectionsCard } from "@/components/persons/ConnectionsCard";
import { ThreatRadar } from "@/components/persons/ThreatRadar";
import { ActivityHeatmap } from "@/components/persons/ActivityHeatmap";
import { MiniSparkline } from "@/components/persons/MiniSparkline";
import { Avatar } from "@/components/timeline/ParticipantBar";

export const CONCERN_THRESHOLD = 0.25;

type AnalysisTab =
  | "radar"
  | "sparklines"
  | "grooming"
  | "asymmetry"
  | "verdict";

const ANALYSIS_TABS: { value: AnalysisTab; label: string }[] = [
  { value: "radar", label: "Threat radar" },
  { value: "sparklines", label: "Sparklines (trends)" },
  { value: "grooming", label: "Grooming stages" },
  { value: "asymmetry", label: "Communication asymmetry" },
  { value: "verdict", label: "Role & verdict" },
];

function band(score: number): {
  label: string;
  chip: string;
  bar: string;
  text: string;
} {
  if (score >= 0.6)
    return {
      label: "HIGH CONCERN",
      chip: "bg-accent-red/10 text-accent-red",
      bar: "bg-accent-red",
      text: "text-accent-red",
    };
  if (score >= 0.35)
    return {
      label: "MEDIUM CONCERN",
      chip: "bg-accent-amber/15 text-accent-amber",
      bar: "bg-accent-amber",
      text: "text-accent-amber",
    };
  return {
    label: "LOW CONCERN",
    chip: "bg-canvas text-label-secondary",
    bar: "bg-label-tertiary",
    text: "text-label-tertiary",
  };
}

const SIGNAL_LABELS: Record<SignalKey, string> = {
  isolation: "Isolation / secrecy",
  channel_migration: "Channel migration",
  contact_escalation: "Contact escalation",
  age_probe: "Age probes",
};

const SIGNAL_ORDER: SignalKey[] = [
  "isolation",
  "channel_migration",
  "contact_escalation",
  "age_probe",
];

const STAGE_ORDER = [
  "contact",
  "trust_building",
  "isolation",
  "channel_migration",
  "escalation",
  "contact_request",
];

const STAGE_LABELS: Record<string, string> = {
  contact: "Contact",
  trust_building: "Trust building",
  isolation: "Isolation",
  channel_migration: "Channel migration",
  escalation: "Escalation",
  contact_request: "Contact request",
};

const STAGE_COLORS: Record<string, string> = {
  contact: "#007AFF",
  trust_building: "#34C759",
  isolation: "#FF9500",
  channel_migration: "#AF52DE",
  escalation: "#FF3B30",
  contact_request: "#FF2D55",
};

function roleAndVerdict(
  profile: SignalProfile,
  top: SignalProfile | undefined,
): { role: string; corroboration: string; roleChip: string } {
  if (profile.risk_score >= CONCERN_THRESHOLD) {
    return {
      role: "Person of concern",
      corroboration:
        profile.risk_score >= 0.6
          ? "High"
          : profile.risk_score >= 0.35
            ? "Medium"
            : "Low",
      roleChip: "bg-accent-red/10 text-accent-red",
    };
  }
  const isCounterparty = top?.counterparties.includes(profile.label);
  if (isCounterparty) {
    const sigCount = Object.values(profile.signal_counts).reduce(
      (a, b) => a + (b ?? 0),
      0,
    );
    return {
      role: "Child at risk",
      corroboration:
        sigCount >= 3 ? "Medium" : sigCount >= 1 ? "Low" : "Low",
      roleChip: "bg-accent-amber/15 text-accent-amber",
    };
  }
  return {
    role: "Unclear",
    corroboration: "Low",
    roleChip: "bg-canvas text-label-tertiary",
  };
}

function highestStageReached(
  profile: SignalProfile,
  top: SignalProfile | undefined,
): { stage: string; pct: number } {
  if (!top) return { stage: "contact", pct: 0 };
  const signals = Object.keys(profile.signal_counts);
  const signalToStage: Record<string, string> = {
    isolation: "isolation",
    channel_migration: "channel_migration",
    contact_escalation: "contact_request",
    age_probe: "escalation",
  };
  let highest = 0;
  for (const sig of signals) {
    const stage = signalToStage[sig];
    if (stage) {
      const idx = STAGE_ORDER.indexOf(stage);
      if (idx > highest) highest = idx;
    }
  }
  if (highest === 0 && profile.risk_score >= 0.1) highest = 1;
  return {
    stage: STAGE_ORDER[highest],
    pct: Math.round(((highest + 1) / STAGE_ORDER.length) * 100),
  };
}

export function PersonsView({
  caseId,
  onSelectArtifact,
  onOpenGraph,
}: {
  caseId: string;
  onSelectArtifact?: (artifactId: string) => void;
  onOpenGraph?: () => void;
}) {
  const [profiles, setProfiles] = useState<SignalProfile[] | null>(null);
  const [identities, setIdentities] = useState<ResolvedActor[] | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showScoring, setShowScoring] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("radar");

  useEffect(() => {
    Promise.all([
      getJson<SignalProfile[]>(`/api/cases/${caseId}/signals`),
      getJson<ResolvedActor[]>(`/api/cases/${caseId}/identities`),
      getJson<GraphData>(`/api/cases/${caseId}/graph`),
    ])
      .then(([s, i, g]) => {
        setProfiles(s);
        setIdentities(i);
        setGraph(g);
      })
      .catch((err) =>
        setError(
          err instanceof Error
            ? `Failed to load persons of interest — ${err.message}`
            : "Failed to load persons of interest",
        ),
      );
  }, [caseId]);

  const actorIndex = useMemo(
    () => (identities ? buildActorIndex(identities) : null),
    [identities],
  );

  const { concerning, others } = useMemo(() => {
    const all = profiles ?? [];
    return {
      concerning: all.filter((p) => p.risk_score >= CONCERN_THRESHOLD),
      others: all.filter((p) => p.risk_score < CONCERN_THRESHOLD),
    };
  }, [profiles]);

  const caseAverage = useMemo(() => {
    if (!profiles || profiles.length === 0)
      return {
        late_night_ratio: 0,
        escalation_slope: 0,
        asymmetry: 0,
        messages_authored: 0,
        share_authored: 0,
      };
    const n = profiles.length;
    return {
      late_night_ratio:
        profiles.reduce((s, p) => s + p.late_night_ratio, 0) / n,
      escalation_slope:
        profiles.reduce((s, p) => s + p.escalation_slope, 0) / n,
      asymmetry: profiles.reduce((s, p) => s + p.asymmetry, 0) / n,
      messages_authored:
        profiles.reduce((s, p) => s + p.messages_authored, 0) / n,
      share_authored: profiles.reduce((s, p) => s + p.asymmetry, 0) / n,
    };
  }, [profiles]);

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!profiles || !actorIndex) {
    return (
      <p className="p-6 text-[13px] text-label-secondary">
        Loading persons of interest…
      </p>
    );
  }

  const top = concerning[0];
  const percentile = top
    ? (
        (profiles.filter((p) => p.risk_score <= top.risk_score).length /
          profiles.length) *
        100
      ).toFixed(1)
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        {/* ── Scoring explainer ── */}
        <section className="rounded-card border border-separator bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[17px] font-semibold tracking-tight text-label-primary">
              Persons of interest
              <Info className="size-3.5 text-label-tertiary" />
            </h2>
            <button
              onClick={() => setShowScoring((v) => !v)}
              aria-expanded={showScoring}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-blue"
            >
              How scoring works
              <ChevronDown
                className={`size-3.5 transition-transform ${showScoring ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          <p className="mt-2 text-[13px] leading-relaxed text-label-secondary">
            Scoring is model-free deterministic. It reflects communication
            patterns and content signals — not guilt.
          </p>

          {showScoring && (
            <div className="mt-3 rounded-control border border-accent-blue/20 bg-accent-blue/5 px-4 py-3 text-[13px] leading-relaxed text-label-secondary">
              <p>
                The score is a weighted sum of per-message rates: isolation
                language and channel migration dominate, age probes and
                escalation slope contribute, and late-night activity only nudges.
                An actor in contact with three or more counterparties is scaled
                up. Only actors at or above{" "}
                <span className="font-mono">{CONCERN_THRESHOLD.toFixed(2)}</span>{" "}
                are named here.
              </p>
            </div>
          )}

          {/* ── Primary POC hero card ── */}
          {top && (
            <div className="mt-4 rounded-xl border border-separator bg-canvas p-5">
              <div className="flex flex-wrap items-start gap-5">
                <Avatar name={top.label} size={72} />
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${band(top.risk_score).chip}`}
                  >
                    {band(top.risk_score).label}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-[22px] font-bold tracking-tight text-label-primary">
                      {top.label}
                    </h3>
                    <span className="rounded-full bg-accent-blue/10 px-2.5 py-0.5 text-[11px] font-medium text-accent-blue">
                      Person of concern
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {top.identifiers.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-separator px-2.5 py-1 font-mono text-[11px] text-label-secondary"
                      >
                        {/^\+?\d{7,}$/.test(id) && (
                          <Phone className="size-3 text-label-tertiary" />
                        )}
                        {id}
                      </span>
                    ))}
                    {top.channels.map((ch) => (
                      <span
                        key={ch}
                        className="inline-flex items-center gap-1 rounded-full border border-separator px-2.5 py-1 text-[11px] text-label-secondary"
                      >
                        <PlatformBadge
                          platform={platformFromSource(ch)}
                          size={12}
                        />
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-label-tertiary">
                    Risk score
                  </p>
                  <p className="mt-1 font-mono text-[28px] font-bold leading-none text-label-primary">
                    {top.risk_score.toFixed(2)}
                    <span className="text-[16px] text-label-tertiary">
                      {" "}
                      / 1.00
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-label-tertiary">
                    Percentile: {percentile}th{" "}
                    <Info className="ml-0.5 inline size-3 text-label-quaternary" />
                  </p>
                </div>
              </div>

              {/* Stats row */}
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-separator pt-4 sm:grid-cols-3 lg:grid-cols-5">
                <StatCell
                  label="Messages authored"
                  value={String(top.messages_authored)}
                  sparkline={top.weekly_trend}
                />
                <StatCell
                  label="Contacts"
                  value={String(top.counterparties.length)}
                  icon={
                    <span className="text-[14px] text-label-tertiary">👥</span>
                  }
                />
                <StatCell
                  label="Late-night activity"
                  value={`${Math.round(top.late_night_ratio * 100)}%`}
                  hint={top.peak_hours ?? "22:00 – 02:59"}
                  sparkline={top.hourly_activity}
                  sparkColor="var(--accent-red)"
                />
                <StatCell
                  label="Escalation slope"
                  value={top.escalation_slope.toFixed(2)}
                  hint="asks cluster late"
                />
                <StatCell
                  label="Asymmetry (sent/recv)"
                  value={top.asymmetry.toFixed(2)}
                  hint="share authored"
                />
              </div>

              {/* Analysis tabs */}
              <div className="mt-4 border-t border-separator pt-3">
                <div className="flex gap-0 overflow-x-auto">
                  {ANALYSIS_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setAnalysisTab(tab.value)}
                      className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                        analysisTab === tab.value
                          ? "border-accent-blue text-accent-blue"
                          : "border-transparent text-label-tertiary hover:text-label-primary"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  {analysisTab === "radar" && (
                    <ThreatRadar
                      profile={top}
                      caseAverage={caseAverage}
                    />
                  )}
                  {analysisTab === "sparklines" && (
                    <SparklinePanel profile={top} />
                  )}
                  {analysisTab === "grooming" && (
                    <GroomingPanel
                      profile={top}
                      others={others}
                      onSelectArtifact={onSelectArtifact}
                    />
                  )}
                  {analysisTab === "asymmetry" && (
                    <AsymmetryPanel profile={top} profiles={profiles} />
                  )}
                  {analysisTab === "verdict" && (
                    <VerdictPanel profile={top} profiles={profiles} />
                  )}
                </div>
              </div>
            </div>
          )}

          {concerning.length === 0 && (
            <p className="py-14 text-center text-[13px] text-label-tertiary">
              No actor in this case reaches the concern threshold.
            </p>
          )}
        </section>

        {/* ── Other actors table ── */}
        <section className="rounded-card border border-separator bg-surface p-5">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-label-primary">
            Other actors in this case
            <Info className="size-3.5 text-label-tertiary" />
          </h3>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-separator text-[11px] font-medium uppercase tracking-wider text-label-tertiary">
                  <th className="py-2 pr-3 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Role &amp; verdict</th>
                  <th className="px-3 py-2 font-medium">Risk score</th>
                  <th className="px-3 py-2 font-medium">Grooming stage</th>
                  <th className="px-3 py-2 font-medium">
                    Activity trend (last 6 months)
                  </th>
                  <th className="px-3 py-2 font-medium">Key signals</th>
                  <th className="w-8 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {others.map((profile) => (
                  <ActorRow
                    key={profile.actor_id}
                    profile={profile}
                    top={top}
                    actorIndex={actorIndex}
                    onSelectArtifact={onSelectArtifact}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── Right sidebar ── */}
      <aside className="flex flex-col gap-4">
        <CaseSummaryCard profile={top} totalActors={profiles.length} />
        <RiskFactorsCard profile={top} />
        <ConnectionsCard
          graph={graph}
          profile={top}
          actorIndex={actorIndex}
          onOpenGraph={() => onOpenGraph?.()}
        />
        {top && (
          <ActivityHeatmap
            dayHour={top.day_hour_activity}
            label={top.label}
          />
        )}

        <div className="rounded-card border border-separator bg-accent-blue/5 p-4">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-label-secondary">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-blue" />
            All scores reflect communication patterns only. Corroboration and
            evidentiary review are required for any action.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ── Sub-components ── */

function StatCell({
  label,
  value,
  hint,
  sparkline,
  sparkColor,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  sparkline?: number[];
  sparkColor?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-label-tertiary">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <p className="font-mono text-[18px] font-semibold text-label-primary">
          {value}
        </p>
        {icon}
        {sparkline && sparkline.length >= 2 && (
          <MiniSparkline
            series={sparkline}
            color={sparkColor ?? "var(--accent-blue)"}
            width={50}
            height={18}
          />
        )}
      </div>
      {hint && (
        <p className="truncate text-[11px] text-label-tertiary">{hint}</p>
      )}
    </div>
  );
}

function CaseSummaryCard({
  profile,
  totalActors,
}: {
  profile: SignalProfile | undefined;
  totalActors: number;
}) {
  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-label-primary">
          Case summary
        </h3>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] text-label-tertiary">
          Computed
        </span>
      </div>
      {profile ? (
        <p className="mt-2 text-[13px] leading-relaxed text-label-secondary">
          Of {totalActors} actors who authored messages,{" "}
          <span className="font-medium text-label-primary">
            {profile.label}
          </span>{" "}
          is the only one at or above the concern threshold, scoring{" "}
          <span className="font-mono">{profile.risk_score.toFixed(2)}</span>{" "}
          across {profile.channels.length} channels and{" "}
          {profile.counterparties.length} contacts. The pattern is repetitive:
          the same approach appears in separate threads rather than escalating in
          one.
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-label-tertiary">
          No actor reaches the concern threshold.
        </p>
      )}
    </section>
  );
}

function RiskFactorsCard({
  profile,
}: {
  profile: SignalProfile | undefined;
}) {
  if (!profile) return null;

  const factors = [
    {
      label: `Late-night activity (22:00–02:59)`,
      value: `${Math.round(profile.late_night_ratio * 100)}%`,
      tone: profile.late_night_ratio >= 0.2,
    },
    {
      label: "Escalation slope",
      value: profile.escalation_slope.toFixed(2),
      tone: profile.escalation_slope > 0.2,
    },
    {
      label: "Share of thread authored",
      value: profile.asymmetry.toFixed(2),
      tone: profile.asymmetry >= 0.5,
    },
    {
      label: "Separate contacts",
      value: String(profile.counterparties.length),
      tone: profile.counterparties.length >= 3,
    },
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-label-primary">
        Top risk factors
      </h3>
      <p className="mt-0.5 text-[11px] text-label-tertiary">
        for {profile.label}
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {factors.map((factor) => (
          <li
            key={factor.label}
            className="flex items-start justify-between gap-3"
          >
            <span className="flex min-w-0 gap-2 text-[13px] text-label-secondary">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  factor.tone ? "bg-accent-red" : "bg-accent-amber"
                }`}
              />
              {factor.label}
            </span>
            <span className="shrink-0 font-mono text-[13px] text-label-primary">
              {factor.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActorRow({
  profile,
  top,
  actorIndex,
  onSelectArtifact,
}: {
  profile: SignalProfile;
  top: SignalProfile | undefined;
  actorIndex: { color: (id: string) => string };
  onSelectArtifact?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rv = roleAndVerdict(profile, top);
  const stage = highestStageReached(profile, top);
  const signals = SIGNAL_ORDER.filter(
    (k) => (profile.signal_counts[k] ?? 0) > 0,
  );

  const riskDot =
    profile.risk_score >= 0.5
      ? "bg-accent-red"
      : profile.risk_score >= 0.25
        ? "bg-accent-amber"
        : "bg-accent-blue";

  return (
    <>
      <tr
        className="cursor-pointer border-b border-separator/50 transition-colors hover:bg-surface/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 pr-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={profile.label} size={32} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-label-primary">
                {profile.label}
              </p>
              <p className="truncate text-[11px] text-label-tertiary">
                @{profile.identifiers[0]}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${rv.roleChip}`}
          >
            {rv.role}
          </span>
          <p className="mt-0.5 text-[10px] text-label-tertiary">
            Corroboration: {rv.corroboration}
          </p>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] text-label-primary">
              {profile.risk_score.toFixed(2)}
            </span>
            <span className={`size-2 rounded-full ${riskDot}`} />
          </div>
        </td>
        <td className="px-3 py-3">
          <div className="min-w-[120px]">
            <div className="flex items-center justify-between text-[11px]">
              <span
                className="font-medium"
                style={{ color: STAGE_COLORS[stage.stage] }}
              >
                {STAGE_LABELS[stage.stage]}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${stage.pct}%`,
                  backgroundColor: STAGE_COLORS[stage.stage],
                }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-label-tertiary">
              {stage.pct}% complete
            </p>
          </div>
        </td>
        <td className="px-3 py-3">
          {profile.weekly_trend && profile.weekly_trend.length >= 2 ? (
            <MiniSparkline
              series={profile.weekly_trend}
              width={80}
              height={24}
            />
          ) : (
            <span className="text-[11px] text-label-quaternary">—</span>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {profile.channels.some((c) => c.includes("call")) && (
              <Phone className="size-3.5 text-label-tertiary" />
            )}
            {signals.length > 0 && (
              <ArrowUpRight className="size-3.5 text-label-tertiary" />
            )}
            {profile.messages_authored > 0 && (
              <MessageSquare className="size-3.5 text-label-tertiary" />
            )}
            {signals.length > 0 && (
              <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-label-secondary">
                +{signals.length}
              </span>
            )}
          </div>
        </td>
        <td className="py-3 text-center">
          <ChevronRight
            className={`size-4 text-label-tertiary transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="border-b border-separator bg-surface/30 px-4 py-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase text-label-tertiary">
                  Messages
                </p>
                <p className="font-mono text-[14px] text-label-primary">
                  {profile.messages_authored}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-label-tertiary">
                  Late-night
                </p>
                <p className="font-mono text-[14px] text-label-primary">
                  {Math.round(profile.late_night_ratio * 100)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-label-tertiary">
                  Escalation
                </p>
                <p className="font-mono text-[14px] text-label-primary">
                  {profile.escalation_slope.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-label-tertiary">
                  Asymmetry
                </p>
                <p className="font-mono text-[14px] text-label-primary">
                  {profile.asymmetry.toFixed(2)}
                </p>
              </div>
            </div>
            {signals.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] uppercase text-label-tertiary">
                  Signals
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {signals.map((key) => (
                    <span
                      key={key}
                      className="rounded-control bg-canvas px-2 py-1 text-[12px] text-label-primary"
                    >
                      <span className="font-semibold">
                        {profile.signal_counts[key]}
                      </span>{" "}
                      {SIGNAL_LABELS[key]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(profile.signal_evidence ?? {}).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.values(profile.signal_evidence ?? {})
                  .flat()
                  .slice(0, 6)
                  .map((id) => (
                    <button
                      key={id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectArtifact?.(id);
                      }}
                      className="rounded bg-accent-blue/5 px-1.5 py-0.5 font-mono text-[10px] text-accent-blue hover:bg-accent-blue/15"
                    >
                      {id}
                    </button>
                  ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Analysis tab panels ── */

function SparklinePanel({ profile }: { profile: SignalProfile }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MiniStat
          label="Messages / week"
          series={profile.weekly_trend}
          color="var(--accent-blue)"
        />
        <MiniStat
          label="Hourly activity"
          series={profile.hourly_activity}
          color="var(--accent-purple, #AF52DE)"
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  series,
  color,
}: {
  label: string;
  series: number[];
  color: string;
}) {
  const total = series.reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...series);
  return (
    <div className="rounded-xl border border-separator bg-canvas p-3">
      <p className="text-[11px] text-label-tertiary">{label}</p>
      <p className="text-[18px] font-semibold text-label-primary">
        {total}
        <span className="ml-1 text-[11px] text-label-tertiary">
          (peak {peak})
        </span>
      </p>
      {series.length >= 2 && (
        <MiniSparkline
          series={series}
          color={color}
          width={180}
          height={30}
        />
      )}
    </div>
  );
}

function GroomingPanel({
  profile,
  others,
  onSelectArtifact,
}: {
  profile: SignalProfile;
  others: SignalProfile[];
  onSelectArtifact?: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-label-secondary">
        Grooming stages reached with each counterparty of{" "}
        <span className="font-semibold text-label-primary">
          {profile.label}
        </span>
        .
      </p>
      <div className="flex flex-col gap-2">
        {profile.counterparties.map((cp) => {
          const cpProfile = others.find((o) => o.label === cp);
          const stage = cpProfile
            ? highestStageReached(cpProfile, profile)
            : { stage: "contact", pct: 17 };
          return (
            <div
              key={cp}
              className="flex items-center gap-3 rounded-lg border border-separator bg-canvas px-3 py-2"
            >
              <Avatar name={cp} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-label-primary">
                {cp}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{
                  backgroundColor: STAGE_COLORS[stage.stage] ?? "#8E8E93",
                }}
              >
                {STAGE_LABELS[stage.stage]}
              </span>
              <div className="w-20">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-separator">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${stage.pct}%`,
                      backgroundColor:
                        STAGE_COLORS[stage.stage] ?? "#8E8E93",
                    }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-label-tertiary">
                {stage.pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AsymmetryPanel({
  profile,
  profiles,
}: {
  profile: SignalProfile;
  profiles: SignalProfile[];
}) {
  const sent = profile.messages_authored;
  const received = profiles
    .filter((p) => profile.counterparties.includes(p.label))
    .reduce((s, p) => s + p.messages_authored, 0);
  const total = sent + received;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-label-secondary">
        Communication balance between{" "}
        <span className="font-semibold text-label-primary">
          {profile.label}
        </span>{" "}
        and their counterparties.
      </p>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[11px] text-label-tertiary">
            <span>Sent ({sent})</span>
            <span>Received ({received})</span>
          </div>
          <div className="mt-1 flex h-4 w-full overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full bg-accent-red"
              style={{ width: total > 0 ? `${(sent / total) * 100}%` : "50%" }}
            />
            <div
              className="h-full bg-accent-blue"
              style={{
                width: total > 0 ? `${(received / total) * 100}%` : "50%",
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-separator bg-canvas p-3 text-center">
          <p className="text-[10px] text-label-tertiary">Asymmetry</p>
          <p className="mt-1 font-mono text-[20px] font-bold text-label-primary">
            {profile.asymmetry.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-separator bg-canvas p-3 text-center">
          <p className="text-[10px] text-label-tertiary">Sent</p>
          <p className="mt-1 font-mono text-[20px] font-bold text-accent-red">
            {sent}
          </p>
        </div>
        <div className="rounded-lg border border-separator bg-canvas p-3 text-center">
          <p className="text-[10px] text-label-tertiary">Received</p>
          <p className="mt-1 font-mono text-[20px] font-bold text-accent-blue">
            {received}
          </p>
        </div>
      </div>
    </div>
  );
}

function VerdictPanel({
  profile,
  profiles,
}: {
  profile: SignalProfile;
  profiles: SignalProfile[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-label-secondary">
        Role classification for all actors, relative to{" "}
        <span className="font-semibold text-label-primary">
          {profile.label}
        </span>
        .
      </p>
      <div className="flex flex-col gap-2">
        {profiles.map((p) => {
          const rv = roleAndVerdict(p, profile);
          return (
            <div
              key={p.actor_id}
              className="flex items-center gap-3 rounded-lg border border-separator bg-canvas px-3 py-2.5"
            >
              <Avatar name={p.label} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-label-primary">
                {p.label}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rv.roleChip}`}
              >
                {rv.role}
              </span>
              <span className="text-[10px] text-label-tertiary">
                Corroboration: {rv.corroboration}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

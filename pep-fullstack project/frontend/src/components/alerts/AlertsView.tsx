"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Info, Search, ShieldAlert, Undo2 } from "lucide-react";
import type { Alert, AlertSeverity, AlertsResponse, SignalProfile } from "@/lib/types";
import { getJson } from "@/lib/fetchJson";

/**
 * Alerts — deterministic rules over the evidence, each one citable.
 *
 * The three things that keep this from being decoration:
 *
 * - **Every alert shows the rule that fired it.** "Why this fired" is on
 *   the card, not buried in a tooltip. An alert an officer can't
 *   interrogate is one they learn to scroll past, and an alert nobody
 *   reads is worse than no alert.
 * - **No "3 new" badge.** Nothing in this build records when an officer
 *   last looked, so an unread count could only be invented — the same
 *   reason the dashboard carries no trend deltas. What's shown instead is
 *   open vs acknowledged, because acknowledgement is a thing that
 *   actually happened.
 * - **Acknowledging never hides anything.** An acknowledged alert stays
 *   on screen, greyed and undoable. Alerts that vanish when ticked are
 *   how findings get lost.
 *
 * The score column is populated only where a real number exists — an
 * actor's risk score, a correlation score, a channel span. A known-hash
 * match has none, and its slot stays empty rather than being filled to
 * make the column look tidy.
 *
 * Nothing is computed here: the rules, the gating and the counts all live
 * in `backend/alerts.py`.
 */

const SEVERITY: Record<
  AlertSeverity,
  { label: string; dot: string; text: string; rail: string; chip: string }
> = {
  critical: {
    label: "Critical",
    dot: "bg-accent-red",
    text: "text-accent-red",
    rail: "bg-accent-red",
    chip: "bg-accent-red/10 text-accent-red",
  },
  high: {
    label: "High",
    dot: "bg-accent-amber",
    text: "text-accent-amber",
    rail: "bg-accent-amber",
    chip: "bg-accent-amber/15 text-accent-amber",
  },
  medium: {
    label: "Medium",
    dot: "bg-accent-blue",
    text: "text-accent-blue",
    rail: "bg-accent-blue",
    chip: "bg-accent-blue/10 text-accent-blue",
  },
};

// Only the severities the rule set can actually emit. A "0 Low" chip
// would imply a band that no rule in alerts.py produces.
const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium"];

const DONUT_COLOR: Record<AlertSeverity, string> = {
  critical: "var(--accent-red)",
  high: "var(--accent-amber)",
  medium: "var(--accent-blue)",
};

type SortKey = "severity" | "recent";

export function AlertsView({
  caseId,
  onSelectArtifact,
  onSummary,
  onOpenReport,
}: {
  caseId: string;
  /** Evidence IDs open on the Timeline, same as everywhere else. */
  onSelectArtifact?: (artifactId: string) => void;
  /** Lets the case header show the open-alert count without a second
   * request for data this view already has. */
  onSummary?: (summary: { open: number; total: number }) => void;
  onOpenReport?: () => void;
}) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [profiles, setProfiles] = useState<SignalProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("severity");

  const load = useCallback(
    () => getJson<AlertsResponse>(`/api/cases/${caseId}/alerts`),
    [caseId],
  );

  useEffect(() => {
    load()
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof Error
            ? `Failed to load alerts — ${err.message}`
            : "Failed to load alerts",
        ),
      );
  }, [load]);

  useEffect(() => {
    getJson<SignalProfile[]>(`/api/cases/${caseId}/signals`)
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [caseId]);

  useEffect(() => {
    if (data) onSummary?.({ open: data.open, total: data.total });
  }, [data, onSummary]);

  async function setAcknowledged(alert: Alert, acknowledged: boolean) {
    // Optimistic: the ruling is the officer's and the round trip
    // shouldn't make the button feel laggy. Re-sorting is left to the
    // backend on the next load so a card doesn't leap away under the
    // cursor the instant it's ticked.
    setData((prev) =>
      prev
        ? {
            ...prev,
            alerts: prev.alerts.map((a) =>
              a.alert_id === alert.alert_id ? { ...a, acknowledged } : a,
            ),
            open: prev.open + (acknowledged ? -1 : 1),
            acknowledged: prev.acknowledged + (acknowledged ? 1 : -1),
            counts: {
              ...prev.counts,
              [alert.severity]:
                prev.counts[alert.severity] + (acknowledged ? -1 : 1),
            },
          }
        : prev,
    );

    try {
      const res = await fetch(
        `/api/cases/${caseId}/alerts/${encodeURIComponent(alert.alert_id)}/ack?acknowledged=${acknowledged}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error();
    } catch {
      // Put the truth back rather than leaving a tick the backend never
      // recorded.
      const fresh = await load().catch(() => null);
      if (fresh) setData(fresh);
    }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const filtered = data.alerts.filter((a) => {
      if (severity && a.severity !== severity) return false;
      if (openOnly && a.acknowledged) return false;
      if (!q) return true;
      return [a.title, a.detail, a.rule, a.actor ?? "", ...a.evidence]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    if (sort === "recent") {
      // Alerts without a timestamp (actor-level rules describe a pattern,
      // not a moment) sort last rather than being given a fake time.
      return [...filtered].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
    }
    return filtered;
  }, [data, query, severity, openOnly, sort]);

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!data) return <p className="p-6 text-[13px] text-label-secondary">Loading alerts…</p>;

  const topProfile = profiles?.[0];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-card border border-separator bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-label-primary">
              Alerts
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-label-secondary">
              <ShieldAlert className="size-3.5 text-label-tertiary" />
              Deterministic rules over this case&rsquo;s evidence — no model involved.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-control border border-separator bg-canvas px-3 py-1.5 focus-within:border-accent-blue">
              <Search className="size-3.5 shrink-0 text-label-tertiary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search alerts…"
                className="w-40 min-w-0 bg-transparent text-[13px] text-label-primary outline-none placeholder:text-label-tertiary"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[13px] text-label-secondary">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-control border border-separator bg-canvas px-2 py-1.5 text-[13px] text-label-primary outline-none"
              >
                <option value="severity">Severity</option>
                <option value="recent">Most recent</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {SEVERITY_ORDER.map((key) => {
            const active = severity === key;
            return (
              <button
                key={key}
                onClick={() => setSeverity(active ? null : key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? "bg-accent-blue text-white"
                    : "bg-canvas text-label-secondary hover:text-label-primary"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${active ? "bg-white" : SEVERITY[key].dot}`}
                />
                <span className={`font-semibold ${active ? "" : "text-label-primary"}`}>
                  {data.counts[key]}
                </span>
                {SEVERITY[key].label} open
              </button>
            );
          })}
          <button
            onClick={() => setOpenOnly((v) => !v)}
            aria-pressed={openOnly}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              openOnly
                ? "bg-accent-blue text-white"
                : "bg-canvas text-label-secondary hover:text-label-primary"
            }`}
          >
            <span className={openOnly ? "font-semibold" : "font-semibold text-label-primary"}>
              {data.open}
            </span>{" "}
            Open only
          </button>
        </div>

        <p className="mt-3 text-[13px] text-label-tertiary">
          Rules that name an actor only fire for actors already above the concern
          threshold, so an alert is never raised about a child in this case. There is no
          unread count: nothing here records when you last looked.
        </p>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-label-tertiary">
            {data.alerts.length === 0
              ? "No alert rule fires on this case's evidence."
              : "No alert matches these filters."}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {visible.map((alert) => (
              <AlertCard
                key={alert.alert_id}
                alert={alert}
                onSelectArtifact={onSelectArtifact}
                onSetAcknowledged={setAcknowledged}
              />
            ))}
          </ul>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        <SummaryCard data={data} />
        <RiskFactorsCard profile={topProfile} />
        <ActionsCard
          data={data}
          onAcknowledgeCritical={async () => {
            for (const alert of data.alerts) {
              if (alert.severity === "critical" && !alert.acknowledged) {
                await setAcknowledged(alert, true);
              }
            }
          }}
          onOpenReport={onOpenReport}
        />
      </aside>
    </div>
  );
}

function SummaryCard({ data }: { data: AlertsResponse }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const open = data.open;

  const arcs = SEVERITY_ORDER.map((key, i) => {
    const count = data.counts[key];
    const before = SEVERITY_ORDER.slice(0, i).reduce(
      (sum, k) => sum + data.counts[k],
      0,
    );
    return {
      key,
      dash: open > 0 ? (count / open) * circumference : 0,
      offset: open > 0 ? (before / open) * circumference : 0,
      color: DONUT_COLOR[key],
    };
  });

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-label-primary">Alerts summary</h3>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="relative size-[120px] shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="var(--canvas)"
              strokeWidth="14"
            />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth="14"
                strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                strokeDashoffset={-arc.offset}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[22px] font-semibold text-label-primary">{open}</span>
            <span className="text-[11px] text-label-tertiary">Open</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {SEVERITY_ORDER.map((key) => (
            <li key={key} className="flex items-center gap-2 text-[13px]">
              <span className={`size-2 shrink-0 rounded-full ${SEVERITY[key].dot}`} />
              <span className="min-w-0 flex-1 truncate text-label-secondary">
                {SEVERITY[key].label}
              </span>
              <span className="shrink-0 font-medium text-label-primary">
                {data.counts[key]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-[11px] text-label-tertiary">
        {data.acknowledged} of {data.total} acknowledged. Acknowledged alerts stay listed
        rather than disappearing.
      </p>
    </section>
  );
}

function RiskFactorsCard({ profile }: { profile: SignalProfile | undefined }) {
  if (!profile) return null;

  const factors = [
    {
      label: "Late-night activity (22:00–02:59)",
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
  ];

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-label-primary">Top risk factors</h3>
      <p className="mt-0.5 text-[11px] text-label-tertiary">For {profile.label}</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {factors.map((factor) => (
          <li key={factor.label} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 gap-2 text-[13px] text-label-secondary">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  factor.tone ? "bg-accent-red" : "bg-label-tertiary"
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

/**
 * Only actions that exist. The obvious candidates for this card —
 * "Escalate", "Add note" — have no backend behind them, and a button that
 * does nothing is worse than one that isn't there.
 */
function ActionsCard({
  data,
  onAcknowledgeCritical,
  onOpenReport,
}: {
  data: AlertsResponse;
  onAcknowledgeCritical: () => void;
  onOpenReport?: () => void;
}) {
  const openCritical = data.alerts.filter(
    (a) => a.severity === "critical" && !a.acknowledged,
  ).length;

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-label-primary">Alert actions</h3>
      <div className="mt-3 flex flex-col gap-1">
        <button
          onClick={onAcknowledgeCritical}
          disabled={openCritical === 0}
          className="flex items-center gap-2 rounded-control px-2 py-2 text-left text-[13px] text-label-primary transition-colors hover:bg-canvas disabled:cursor-default disabled:text-label-tertiary disabled:hover:bg-transparent"
        >
          <Check className="size-4 shrink-0 text-accent-green" />
          Acknowledge all critical
          {openCritical > 0 && (
            <span className="ml-auto font-mono text-[11px] text-label-tertiary">
              {openCritical}
            </span>
          )}
        </button>
        <button
          onClick={() => onOpenReport?.()}
          disabled={!onOpenReport}
          className="flex items-center gap-2 rounded-control px-2 py-2 text-left text-[13px] text-label-primary transition-colors hover:bg-canvas disabled:cursor-default disabled:text-label-tertiary"
        >
          <FileText className="size-4 shrink-0 text-accent-blue" />
          Open case report
        </button>
      </div>
    </section>
  );
}

function formatWhen(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlertCard({
  alert,
  onSelectArtifact,
  onSetAcknowledged,
}: {
  alert: Alert;
  onSelectArtifact?: (artifactId: string) => void;
  onSetAcknowledged: (alert: Alert, acknowledged: boolean) => void;
}) {
  const tone = SEVERITY[alert.severity];
  // Four fits one line at most widths; the rest are reachable from the
  // artifact the first ones lead to.
  const shown = alert.evidence.slice(0, 4);
  const remaining = alert.evidence.length - shown.length;

  return (
    <li
      className={`relative overflow-hidden rounded-card border border-separator bg-surface transition-opacity ${
        alert.acknowledged ? "opacity-60" : ""
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.rail}`} />

      <div className="flex flex-wrap gap-4 py-4 pl-5 pr-4">
        <div className="w-[92px] shrink-0">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}
          >
            {tone.label}
          </span>
          {alert.score !== null && (
            <div className="mt-2">
              <p className="text-[11px] text-label-tertiary">{alert.score_label}</p>
              <p className="font-mono text-[17px] font-semibold text-label-primary">
                {alert.score.toFixed(2)}
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-label-primary">
              {alert.title}
            </h3>
            <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] text-label-tertiary">
              {alert.rule}
            </span>
          </div>

          <p className="mt-1 text-[13px] leading-relaxed text-label-primary">
            {alert.detail}
          </p>

          <p className="mt-1.5 flex gap-2 text-[13px] text-label-secondary">
            <Info className="mt-0.5 size-3.5 shrink-0 text-label-tertiary" />
            <span>
              <span className="text-label-tertiary">Why this fired — </span>
              {alert.why}
            </span>
          </p>

          {shown.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-label-tertiary">Evidence</span>
              {shown.map((id) => (
                <button
                  key={id}
                  onClick={() => onSelectArtifact?.(id)}
                  disabled={!onSelectArtifact}
                  className="rounded-control bg-accent-blue/5 px-2 py-1 font-mono text-[11px] text-accent-blue transition-colors hover:bg-accent-blue/15 disabled:pointer-events-none disabled:bg-canvas disabled:text-label-secondary"
                >
                  {id}
                </button>
              ))}
              {remaining > 0 && (
                <span className="text-[11px] text-label-tertiary">+{remaining}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          {/* Only rules tied to a moment carry a time. An actor-level rule
              describes a pattern across the whole case, so it shows none
              rather than borrowing one. */}
          <span className="text-[11px] text-label-tertiary">
            {alert.time ? formatWhen(alert.time) : "Case-wide pattern"}
          </span>

          <div className="flex items-center gap-2">
            {alert.acknowledged && (
              <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[11px] font-medium text-accent-green">
                Acknowledged
              </span>
            )}
            <button
              onClick={() => onSetAcknowledged(alert, !alert.acknowledged)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                alert.acknowledged
                  ? "bg-canvas text-label-secondary hover:text-label-primary"
                  : "bg-canvas text-accent-green hover:bg-accent-green/10"
              }`}
            >
              {alert.acknowledged ? (
                <>
                  <Undo2 className="size-3.5" />
                  Reopen
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  Acknowledge
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

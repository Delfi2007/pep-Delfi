"use client";

import Link from "next/link";
import {
  Bell,
  Briefcase,
  ChevronRight,
  Download,
  Flag,
  Gauge,
  ScanLine,
  Users,
} from "lucide-react";
import type { Case, SignalProfile } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";

/**
 * Case header and the stat strip beneath it.
 *
 * Every tile is counted from this case's own evidence. Two of them are
 * deliberately narrower than they look on first reading, and the labels
 * say so:
 *
 * - **Persons of interest** counts actors at or above the concern
 *   threshold, not every actor in the case. Counting all of them under
 *   this label would put the victims in the number, which is the exact
 *   thing the People tab's threshold exists to prevent.
 * - **Highest risk score** is one actor's score, so it's labelled as the
 *   highest rather than presented as a property of the case. A per-actor
 *   figure shown as a case-level metric is how a dashboard starts lying:
 *   the case doesn't have an escalation slope, an actor does.
 */
export function CaseHeader({
  caseData,
  artifactCount,
  flaggedCount,
  profiles,
  concernThreshold,
  onExport,
  viewLabel,
  openAlerts,
}: {
  caseData: Case;
  artifactCount: number;
  flaggedCount: number;
  /** null while the signal profiles are still loading. */
  profiles: SignalProfile[] | null;
  concernThreshold: number;
  onExport: () => void;
  /** Current tab, shown as the last breadcrumb crumb. */
  viewLabel: string;
  /** Open-alert count, handed up by the Alerts view once it has loaded.
   * The third tile swaps to it there, because on that screen it's the
   * number the officer is actually working to. Undefined elsewhere, and
   * the tile falls back to persons of interest rather than showing a
   * count nothing has computed. */
  openAlerts?: number;
}) {
  const concerning = profiles?.filter((p) => p.risk_score >= concernThreshold) ?? [];
  const top = profiles?.[0];

  return (
    <div className="border-b border-separator bg-surface px-6 pb-0 pt-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px]">
        <Link
          href="/cases"
          className="text-label-secondary transition-colors hover:text-label-primary"
        >
          Cases
        </Link>
        <ChevronRight className="size-3.5 text-label-tertiary" />
        <span className="truncate text-label-secondary">
          {caseData.title}
          {caseData.fir_number && (
            <span className="text-label-tertiary"> ({caseData.fir_number})</span>
          )}
        </span>
        <ChevronRight className="size-3.5 text-label-tertiary" />
        <span className="font-medium text-label-primary">{viewLabel}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-blue/10">
            <Briefcase className="size-4.5 text-accent-blue" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[22px] font-semibold tracking-tight text-label-primary">
                {caseData.title}
              </h1>
              <StatusBadge status={caseData.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-label-secondary">
              <span className="font-mono">{caseData.fir_number ?? caseData.case_id}</span>
              <span className="text-label-tertiary">•</span>
              <span>Opened {formatDate(caseData.created_at)}</span>
              {caseData.investigating_officer && (
                <>
                  <span className="text-label-tertiary">•</span>
                  {/* The officer the *case* names, not a signed-in user —
                      this build has no auth, so "assigned to you" would be
                      a fiction. */}
                  <span>Officer: {caseData.investigating_officer}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={onExport}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-separator px-3 py-1.5 text-[13px] font-medium text-label-primary transition-colors hover:bg-canvas"
        >
          <Download className="size-3.5" />
          Export
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          icon={ScanLine}
          tone="blue"
          value={String(artifactCount)}
          label="Artifacts parsed"
        />
        <Stat
          icon={Flag}
          tone={flaggedCount > 0 ? "red" : "grey"}
          value={String(flaggedCount)}
          label="Flags raised"
        />
        {openAlerts === undefined ? (
          <Stat
            icon={Users}
            tone="grey"
            value={profiles ? String(concerning.length) : "—"}
            label={`At or above ${concernThreshold.toFixed(2)} threshold`}
            title="Persons of interest"
          />
        ) : (
          <Stat
            icon={Bell}
            tone={openAlerts > 0 ? "red" : "grey"}
            value={String(openAlerts)}
            label="Not yet acknowledged"
            title="Open alerts"
          />
        )}
        <Stat
          icon={Gauge}
          tone="grey"
          value={top ? `${Math.round(top.late_night_ratio * 100)}%` : "—"}
          label={top ? `Late-night share — ${top.label}` : "Late-night share"}
        />
        <Stat
          icon={Gauge}
          tone={top && top.risk_score >= 0.6 ? "red" : "grey"}
          value={top ? top.risk_score.toFixed(2) : "—"}
          label={top ? `Highest risk score — ${top.label}` : "Highest risk score"}
          pill={top && top.risk_score >= 0.6 ? "High" : undefined}
        />
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TONE: Record<string, string> = {
  blue: "bg-accent-blue/10 text-accent-blue",
  red: "bg-accent-red/10 text-accent-red",
  grey: "bg-canvas text-label-secondary",
};

function Stat({
  icon: Icon,
  tone,
  value,
  label,
  title,
  pill,
}: {
  icon: typeof Flag;
  tone: string;
  value: string;
  label: string;
  title?: string;
  pill?: string;
}) {
  return (
    <div className="rounded-card border border-separator px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-control ${TONE[tone]}`}
        >
          <Icon className="size-3.5" />
        </span>
        {pill && (
          <span className="rounded-full bg-accent-red/15 px-2 py-0.5 text-[11px] font-medium text-accent-red">
            {pill}
          </span>
        )}
      </div>
      {title && <p className="mt-2 text-[11px] text-label-tertiary">{title}</p>}
      <p className={`${title ? "mt-0.5" : "mt-2"} text-[22px] font-semibold tracking-tight text-label-primary`}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-label-tertiary" title={label}>
        {label}
      </p>
    </div>
  );
}

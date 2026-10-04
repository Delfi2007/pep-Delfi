"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Flag,
  FolderClosed,
  FolderPlus,
  Image as ImageIcon,
  MessageCircle,
  Phone,
  Globe,
  Sparkles,
  Boxes,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EvidenceDonut } from "@/components/dashboard/EvidenceDonut";
import type { ArtifactType, Case, DashboardStats } from "@/lib/types";
import { formatDayHeader, formatTime } from "@/lib/timelineGrouping";

const TYPE_ICON: Record<ArtifactType, typeof MessageCircle> = {
  message: MessageCircle,
  call: Phone,
  image: ImageIcon,
  browser_history: Globe,
};

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [cases, setCases] = useState<Case[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/cases").then((r) => r.json()),
    ])
      .then(([s, c]) => {
        setStats(s);
        setCases(Array.isArray(c) ? c : []);
      })
      .catch(() => setError("Couldn't reach the backend."));
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-[15px] text-accent-red">{error}</p>
        <p className="mt-1 text-[13px] text-label-secondary">
          Is the FastAPI service running? See the README.
        </p>
      </div>
    );
  }

  if (!stats || !cases) {
    return <p className="p-6 text-[13px] text-label-secondary">Loading dashboard…</p>;
  }

  const { totals } = stats;
  const empty = totals.cases === 0;

  return (
    <div className="w-full p-6">
      <div className="mb-5">
        <h1 className="text-[24px] font-semibold tracking-tight text-label-primary">
          Dashboard
        </h1>
        <p className="mt-0.5 text-[13px] text-label-secondary">
          AI-assisted investigation support for child protection cases.
        </p>
      </div>

      {empty ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <FolderPlus className="size-8 text-label-tertiary" />
          <p className="text-[17px] font-semibold text-label-primary">No cases yet</p>
          <p className="max-w-sm text-[13px] text-label-secondary">
            Open a case, then drop in its evidence bundle. Every figure on this
            dashboard is computed from ingested evidence, so it stays empty until
            there is some.
          </p>
          <Link href="/cases/new">
            <Button className="mt-2">Open a case</Button>
          </Link>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total cases"
              value={totals.cases}
              detail={`${totals.open} open · ${totals.closed} closed`}
              Icon={FolderClosed}
              tint="var(--accent-blue)"
            />
            <StatCard
              label="Under review"
              value={totals.under_review}
              detail="Cases awaiting a decision"
              Icon={Activity}
              tint="var(--accent-purple)"
            />
            <StatCard
              label="Evidence items"
              value={totals.artifacts}
              detail="Parsed into the canonical schema"
              Icon={Boxes}
              tint="var(--accent-green)"
            />
            <StatCard
              label="Flagged items"
              value={totals.flagged}
              detail="Known-hash matches, need review"
              Icon={Flag}
              tint="var(--accent-amber)"
              emphasise={totals.flagged > 0}
            />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <Card className="p-4">
              <SectionHeader title="Recent activity" />
              {stats.recent_activity.length === 0 ? (
                <Empty>No evidence ingested yet.</Empty>
              ) : (
                <ul className="space-y-2.5">
                  {stats.recent_activity.map((a) => {
                    const Icon = TYPE_ICON[a.type] ?? MessageCircle;
                    return (
                      <li key={`${a.case_id}-${a.artifact_id}`} className="flex gap-2.5">
                        <span
                          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                            a.flagged ? "bg-accent-amber/15" : "bg-canvas"
                          }`}
                        >
                          <Icon
                            className={`size-3.5 ${
                              a.flagged ? "text-accent-amber" : "text-label-tertiary"
                            }`}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-label-primary">
                            {a.preview || a.source}
                          </p>
                          <p className="truncate text-[11px] text-label-tertiary">
                            {formatDayHeader(a.time.slice(0, 10))} {formatTime(a.time)}
                            {a.tz_inferred && " (inferred)"} · {a.case_title}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <SectionHeader
                title="AI case insight"
                badge={stats.insight ? "signals" : undefined}
              />
              {!stats.insight ? (
                <Empty>Nothing scored above zero yet.</Empty>
              ) : (
                <div>
                  <p className="text-[15px] font-medium leading-snug text-label-primary">
                    {stats.insight.headline}
                  </p>
                  <p className="mt-1.5 text-[13px] text-label-secondary">
                    {stats.insight.signal_summary}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                    <MiniStat
                      label="Risk score"
                      value={stats.insight.risk_score.toFixed(2)}
                    />
                    <MiniStat
                      label="Late-night share"
                      value={`${Math.round(stats.insight.late_night_ratio * 100)}%`}
                    />
                  </dl>
                  <p className="mt-3 text-[11px] text-label-tertiary">
                    Computed from these artifacts:
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {stats.insight.evidence.map((id) => (
                      <span
                        key={id}
                        className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] text-accent-blue"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/cases/${stats.insight.case_id}`}
                    className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent-blue"
                  >
                    Open {stats.insight.case_title}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <SectionHeader
                title="Recent cases"
                action={{ href: "/cases", label: "View all" }}
              />
              <div className="space-y-1.5">
                {cases.slice(0, 5).map((c) => (
                  <Link
                    key={c.case_id}
                    href={`/cases/${c.case_id}`}
                    className="flex items-center gap-2 rounded-control border border-separator px-2.5 py-2 transition-colors hover:bg-canvas"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-label-primary">
                        {c.title}
                      </p>
                      <p className="truncate font-mono text-[11px] text-label-tertiary">
                        {c.fir_number ?? c.case_id}
                      </p>
                    </div>
                    {c.flagged_count > 0 && (
                      <span className="shrink-0 text-[11px] font-medium text-accent-amber">
                        {c.flagged_count} flagged
                      </span>
                    )}
                    <StatusBadge status={c.status} />
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-4">
              <SectionHeader title="Evidence by type" />
              <EvidenceDonut
                breakdown={stats.evidence_by_type}
                total={totals.artifacts}
              />
            </Card>

            <Card className="p-4 xl:col-span-2">
              <SectionHeader title="Flagged items" />
              {stats.flagged_items.length === 0 ? (
                <Empty>Nothing flagged.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="text-[11px] text-label-tertiary">
                        <th className="pb-2 font-medium">Item</th>
                        <th className="pb-2 font-medium">Case</th>
                        <th className="pb-2 font-medium">Reason</th>
                        <th className="pb-2 font-medium">Detected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-separator">
                      {stats.flagged_items.map((f) => (
                        <tr key={`${f.case_id}-${f.artifact_id}`}>
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-1.5">
                              <Flag className="size-3 shrink-0 text-accent-amber" />
                              <span className="truncate text-label-primary">{f.item}</span>
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-label-secondary">
                            <Link
                              href={`/cases/${f.case_id}`}
                              className="hover:text-accent-blue"
                            >
                              {f.case_title}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 text-label-secondary">{f.reason}</td>
                          <td className="py-2 whitespace-nowrap text-label-tertiary">
                            {formatDayHeader(f.time.slice(0, 10))} {formatTime(f.time)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  Icon,
  tint,
  emphasise,
}: {
  label: string;
  value: number;
  detail: string;
  Icon: typeof FolderClosed;
  tint: string;
  emphasise?: boolean;
}) {
  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[12px] text-label-secondary">{label}</p>
        <p
          className="mt-0.5 text-[26px] font-semibold leading-none"
          style={{ color: emphasise ? tint : "var(--label-primary)" }}
        >
          {value}
        </p>
        <p className="mt-1.5 truncate text-[11px] text-label-tertiary">{detail}</p>
      </div>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-control"
        style={{ backgroundColor: `color-mix(in srgb, ${tint} 15%, transparent)` }}
      >
        <Icon className="size-4.5" style={{ color: tint }} />
      </span>
    </Card>
  );
}

function SectionHeader({
  title,
  action,
  badge,
}: {
  title: string;
  action?: { href: string; label: string };
  badge?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[15px] font-semibold text-label-primary">{title}</h2>
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-purple/15 px-2 py-0.5 text-[10px] font-medium text-accent-purple">
            <Sparkles className="size-2.5" />
            {badge}
          </span>
        )}
      </div>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center gap-1 text-[13px] text-accent-blue"
        >
          {action.label}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-separator px-2.5 py-1.5">
      <dt className="text-[10px] text-label-tertiary">{label}</dt>
      <dd className="text-[15px] font-semibold text-label-primary">{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-label-tertiary">{children}</p>;
}

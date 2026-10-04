import type { DashboardStats } from "@/lib/types";

/**
 * Categorical colours, matching the graph's entity-kind palette so the
 * same hue means the same family of thing across the console.
 */
const SLICE_COLORS = [
  "var(--accent-blue)",
  "var(--accent-indigo)",
  "var(--accent-green)",
  "var(--accent-purple)",
  "var(--accent-amber)",
];

export function EvidenceDonut({
  breakdown,
  total,
}: {
  breakdown: DashboardStats["evidence_by_type"];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-label-tertiary">
        No evidence ingested yet.
      </p>
    );
  }

  const radius = 56;
  const circumference = 2 * Math.PI * radius;

  // Each arc's offset is derived from the slices before it rather than
  // accumulated in a mutable counter — render stays pure, which the
  // React Compiler enforces. n is the number of artifact types, so the
  // repeated sum costs nothing.
  const arcs = breakdown.map((slice, i) => ({
    key: slice.type,
    dash: (slice.count / total) * circumference,
    offset:
      (breakdown.slice(0, i).reduce((sum, s) => sum + s.count, 0) / total) *
      circumference,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-[150px] shrink-0">
        <svg viewBox="0 0 150 150" className="size-full -rotate-90">
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth="18"
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold text-label-primary">{total}</span>
          <span className="text-[11px] text-label-tertiary">Total</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {breakdown.map((slice, i) => (
          <li key={slice.type} className="flex items-center gap-2 text-[13px]">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-label-secondary">
              {slice.label}
            </span>
            <span className="shrink-0 font-medium text-label-primary">
              {slice.count}
            </span>
            <span className="w-14 shrink-0 text-right text-label-tertiary">
              {((slice.count / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

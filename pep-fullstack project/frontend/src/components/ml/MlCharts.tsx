/**
 * Small SVG charts for the ML views.
 *
 * ACPIA draws its own charts (EvidenceDonut, MetricSparkline, ThreatRadar)
 * instead of pulling in a chart library, and colours them from the theme
 * tokens so they follow light and dark mode. These follow the same rule:
 * plain SVG, `var(--…)` colours, no new dependency.
 */

const AXIS = "var(--label-tertiary)";
const GRID = "var(--separator)";

/** Categorical colours for up to ten series, drawn from the system palette. */
export const SERIES_COLORS = [
  "#007AFF",
  "#AF52DE",
  "#34C759",
  "#FF9500",
  "#5E5CE6",
  "#FF2D55",
  "#30B0C7",
  "#A2845E",
  "#FFCC00",
  "#8E8E93",
];

/** Horizontal bars, one per row, value in [0, max]. */
export function HBarChart({
  rows,
  max = 1,
  format = (v: number) => v.toFixed(3),
  highlight,
}: {
  rows: { label: string; value: number; color?: string }[];
  max?: number;
  format?: (v: number) => string;
  highlight?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,200px)_1fr_56px] items-center gap-3">
          <span
            className={`truncate text-[12px] ${
              r.label === highlight ? "font-semibold text-label-primary" : "text-label-secondary"
            }`}
            title={r.label}
          >
            {r.label}
          </span>
          <div className="h-2 rounded-full bg-canvas">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(1, Math.min(100, (r.value / max) * 100))}%`,
                background: r.color ?? "var(--accent-blue)",
              }}
            />
          </div>
          <span className="text-right font-mono text-[11px] text-label-primary">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Line chart over [0,1]×[0,1] — PR and ROC curves. */
export function CurveChart({
  series,
  xLabel,
  yLabel,
  height = 240,
  diagonal = false,
}: {
  series: { id: string; label: string; color: string; xs: number[]; ys: number[]; bold?: boolean }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  diagonal?: boolean;
}) {
  const W = 460;
  const H = height;
  const pad = { l: 34, r: 10, t: 10, b: 30 };
  const x = (v: number) => pad.l + v * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - v * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${yLabel} vs ${xLabel}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS}>
            {t}
          </text>
          <text x={x(t)} y={H - pad.b + 14} textAnchor="middle" fontSize={10} fill={AXIS}>
            {t}
          </text>
        </g>
      ))}
      {diagonal && (
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={AXIS} strokeDasharray="4 4" strokeWidth={1} />
      )}
      {series.map((s) => (
        <polyline
          key={s.id}
          fill="none"
          stroke={s.color}
          strokeWidth={s.bold ? 2.5 : 1.3}
          strokeOpacity={s.bold ? 1 : 0.75}
          points={s.xs.map((v, i) => `${x(v)},${y(s.ys[i])}`).join(" ")}
        />
      ))}
      <text x={(x(0) + x(1)) / 2} y={H - 2} textAnchor="middle" fontSize={10} fill={AXIS}>
        {xLabel}
      </text>
      <text
        x={10}
        y={(y(0) + y(1)) / 2}
        textAnchor="middle"
        fontSize={10}
        fill={AXIS}
        transform={`rotate(-90 10 ${(y(0) + y(1)) / 2})`}
      >
        {yLabel}
      </text>
    </svg>
  );
}

/** Vertical bars for a small yearly series. */
export function YearBars({
  data,
  color = "var(--accent-blue)",
  format = (v: number) => v.toLocaleString("en-IN"),
  height = 170,
}: {
  data: { label: string; value: number; muted?: boolean }[];
  color?: string;
  format?: (v: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="font-mono text-[10px] text-label-secondary">{format(d.value)}</span>
          <div
            className="w-full max-w-[44px] rounded-t-md"
            style={{
              height: `${Math.max(2, (d.value / max) * (height - 44))}px`,
              background: color,
              opacity: d.muted ? 0.45 : 1,
            }}
          />
          <span className="text-[11px] text-label-tertiary">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Score bar used for per-thread and per-person scores, with threshold ticks. */
export function ScoreBar({ value, ticks = [] }: { value: number; ticks?: { at: number; label: string }[] }) {
  const color = value >= 0.75 ? "var(--accent-red)" : value >= 0.5 ? "var(--accent-amber)" : "var(--accent-blue)";
  return (
    <div className="relative h-1.5 w-full rounded-full bg-canvas">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(1, value * 100)}%`, background: color }} />
      {ticks.map((t) => (
        <span
          key={t.label}
          title={t.label}
          className="absolute -top-1 h-3.5 w-px bg-label-tertiary"
          style={{ left: `${Math.min(100, t.at * 100)}%` }}
        />
      ))}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

type TimelineEntry = {
  date: string;
  message?: number;
  image?: number;
  call?: number;
  browser_history?: number;
  flagged?: number;
};

type Granularity = "Day" | "Week" | "Month";

const TYPE_COLORS: Record<string, string> = {
  message: "#34C759",
  image: "#FF9500",
  call: "#007AFF",
  browser_history: "#AF52DE",
  flagged: "#FF3B30",
};

export function ResultsTimeline({
  timeline,
}: {
  timeline: TimelineEntry[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("Day");

  const data = useMemo(() => {
    if (granularity === "Day") return timeline;
    const buckets: Record<string, TimelineEntry> = {};
    for (const entry of timeline) {
      let key: string;
      if (granularity === "Week") {
        const d = new Date(entry.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        key = weekStart.toISOString().slice(0, 10);
      } else {
        key = entry.date.slice(0, 7);
      }
      if (!buckets[key]) {
        buckets[key] = { date: key };
      }
      const b = buckets[key];
      for (const t of ["message", "image", "call", "browser_history", "flagged"] as const) {
        (b as Record<string, number>)[t] =
          ((b as Record<string, number>)[t] ?? 0) + ((entry as Record<string, number>)[t] ?? 0);
      }
    }
    return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  }, [timeline, granularity]);

  if (data.length === 0) return null;

  const svgW = 700;
  const svgH = 80;
  const pad = { l: 40, r: 10, t: 10, b: 20 };
  const plotW = svgW - pad.l - pad.r;
  const plotH = svgH - pad.t - pad.b;

  const dates = data.map((d) => new Date(d.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const range = maxDate - minDate || 1;

  const allCounts = data.flatMap((d) =>
    ["message", "image", "call", "browser_history", "flagged"].map(
      (t) => (d as Record<string, number>)[t] ?? 0,
    ),
  );
  const maxCount = Math.max(1, ...allCounts);

  const months = new Set<string>();
  data.forEach((d) => months.add(d.date.slice(0, 7)));
  const monthLabels = [...months].sort();

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-label-primary">
          Results timeline{" "}
          <span className="font-normal text-label-tertiary">(last 6 months)</span>
        </h3>
        <div className="flex gap-0 rounded-full border border-separator bg-canvas">
          {(["Day", "Week", "Month"] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1 text-[11px] font-medium transition-colors first:rounded-l-full last:rounded-r-full ${
                granularity === g
                  ? "bg-accent-blue text-white"
                  : "text-label-tertiary hover:text-label-primary"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="mt-2 h-auto w-full"
        preserveAspectRatio="none"
      >
        {/* Month labels */}
        {monthLabels.map((m) => {
          const t = new Date(m + "-15").getTime();
          const x = pad.l + ((t - minDate) / range) * plotW;
          const label = new Date(m + "-01").toLocaleDateString("en", {
            month: "short",
            year: "2-digit",
          });
          return (
            <text
              key={m}
              x={x}
              y={svgH - 2}
              textAnchor="middle"
              className="fill-label-quaternary"
              style={{ fontSize: 8 }}
            >
              {label}
            </text>
          );
        })}

        {/* Data points */}
        {data.map((entry, i) => {
          const t = new Date(entry.date).getTime();
          const x = pad.l + ((t - minDate) / range) * plotW;

          return (
            <g key={entry.date}>
              {(["message", "image", "call", "browser_history"] as const).map(
                (type, j) => {
                  const count = (entry as Record<string, number>)[type] ?? 0;
                  if (count === 0) return null;
                  const r = 2 + (count / maxCount) * 4;
                  const y = pad.t + plotH * 0.3 + j * (plotH / 5);
                  return (
                    <circle
                      key={type}
                      cx={x}
                      cy={y}
                      r={r}
                      fill={TYPE_COLORS[type]}
                      opacity={0.7}
                    >
                      <title>
                        {entry.date}: {count} {type}
                      </title>
                    </circle>
                  );
                },
              )}
              {(entry.flagged ?? 0) > 0 && (
                <circle
                  cx={x}
                  cy={pad.t + 6}
                  r={3 + ((entry.flagged ?? 0) / maxCount) * 5}
                  fill={TYPE_COLORS.flagged}
                  opacity={0.8}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-label-tertiary">
        {Object.entries(TYPE_COLORS).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {key === "browser_history"
              ? "System events"
              : key === "flagged"
                ? "Flagged"
                : key.charAt(0).toUpperCase() + key.slice(1) + "s"}
          </span>
        ))}
      </div>
    </section>
  );
}

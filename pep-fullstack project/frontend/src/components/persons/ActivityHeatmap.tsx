"use client";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = ["00:00", "06:00", "12:00", "18:00", "24:00"];

export function ActivityHeatmap({
  dayHour,
  label,
}: {
  dayHour: number[][];
  label: string;
}) {
  if (!dayHour || dayHour.length === 0) return null;
  const max = Math.max(1, ...dayHour.flat());

  const cellW = 10;
  const cellH = 16;
  const gapX = 1;
  const gapY = 2;
  const labelW = 30;
  const topPad = 4;
  const bottomPad = 18;

  const gridW = 24 * (cellW + gapX);
  const gridH = 7 * (cellH + gapY);
  const svgW = labelW + gridW + 4;
  const svgH = topPad + gridH + bottomPad;

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-label-primary">
        Late-night activity heatmap
      </h3>
      <p className="mt-0.5 text-[11px] text-label-tertiary">({label})</p>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="mt-2 h-auto w-full"
        role="img"
        aria-label={`Activity heatmap for ${label}`}
      >
        {DAYS.map((day, row) => (
          <text
            key={day}
            x={labelW - 4}
            y={topPad + row * (cellH + gapY) + cellH / 2 + 1}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-label-tertiary"
            style={{ fontSize: 7 }}
          >
            {day}
          </text>
        ))}

        {dayHour.map((hours, row) =>
          hours.map((count, col) => {
            const intensity = count / max;
            const isLateNight = col >= 22 || col <= 2;
            const baseColor = isLateNight
              ? `rgba(255, 59, 48, ${0.1 + intensity * 0.9})`
              : `rgba(0, 122, 255, ${0.08 + intensity * 0.82})`;

            return (
              <rect
                key={`${row}-${col}`}
                x={labelW + col * (cellW + gapX)}
                y={topPad + row * (cellH + gapY)}
                width={cellW}
                height={cellH}
                rx={2}
                fill={count === 0 ? "var(--separator)" : baseColor}
              >
                <title>
                  {DAYS[row]} {col.toString().padStart(2, "0")}:00 — {count}{" "}
                  message{count !== 1 ? "s" : ""}
                </title>
              </rect>
            );
          }),
        )}

        {HOUR_LABELS.map((lbl, i) => (
          <text
            key={lbl}
            x={labelW + i * 6 * (cellW + gapX)}
            y={topPad + gridH + 12}
            textAnchor="start"
            className="fill-label-quaternary"
            style={{ fontSize: 7 }}
          >
            {lbl}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex items-center justify-end gap-1.5">
        <span className="text-[9px] text-label-quaternary">Low</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((o) => (
            <div
              key={o}
              className="size-2.5 rounded-sm"
              style={{
                background: `linear-gradient(135deg, rgba(0,122,255,${o}), rgba(255,59,48,${o}))`,
              }}
            />
          ))}
        </div>
        <span className="text-[9px] text-label-quaternary">High</span>
      </div>
    </section>
  );
}

"use client";

const LATE_NIGHT_HOURS = new Set([22, 23, 0, 1, 2]);

/** A 24-segment ring showing when an actor communicates. Late-night
 * hours (22:00–02:00) render in red regardless of volume, so the
 * suspect's ring lighting up at 11pm–2am with victims is visible
 * without reading a single number off it. */
export function TimeOfDayRing({
  hourly,
  peakHours,
  latePct,
  size = 140,
}: {
  hourly: number[];
  peakHours: string | null;
  latePct: number;
  size?: number;
}) {
  const max = Math.max(1, ...hourly);
  const center = size / 2;
  const outerR = size / 2 - 6;
  const innerR = outerR - 16;

  const segments = hourly.map((count, hour) => {
    const a0 = (hour / 24) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((hour + 1) / 24) * 2 * Math.PI - Math.PI / 2;
    const intensity = count / max;
    const r = innerR + intensity * (outerR - innerR);
    const isLate = LATE_NIGHT_HOURS.has(hour);

    const x0 = center + innerR * Math.cos(a0);
    const y0 = center + innerR * Math.sin(a0);
    const x1 = center + r * Math.cos(a0);
    const y1 = center + r * Math.sin(a0);
    const x2 = center + r * Math.cos(a1);
    const y2 = center + r * Math.sin(a1);
    const x3 = center + innerR * Math.cos(a1);
    const y3 = center + innerR * Math.sin(a1);

    const path = `M ${x0} ${y0} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} L ${x3} ${y3} Z`;
    const color = isLate ? "var(--accent-red)" : "var(--accent-blue)";
    const opacity = count === 0 ? 0.08 : 0.35 + intensity * 0.65;

    return <path key={hour} d={path} fill={color} opacity={opacity} />;
  });

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={innerR} fill="none" stroke="var(--separator)" strokeWidth={1} />
        {segments}
        <text
          x={center}
          y={center - 8}
          textAnchor="middle"
          className="fill-label-tertiary"
          style={{ fontSize: 9 }}
        >
          Peak
        </text>
        <text
          x={center}
          y={center + 6}
          textAnchor="middle"
          className="fill-label-primary"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          {peakHours ?? "—"}
        </text>
        <text
          x={center}
          y={center + 20}
          textAnchor="middle"
          className="fill-accent-red"
          style={{ fontSize: 9, fontWeight: 600 }}
        >
          {latePct > 0 ? `${latePct.toFixed(0)}% night` : ""}
        </text>
        {/* Hour tick labels at cardinal points */}
        <text x={center} y={10} textAnchor="middle" className="fill-label-quaternary" style={{ fontSize: 8 }}>00:00</text>
        <text x={size - 4} y={center + 3} textAnchor="end" className="fill-label-quaternary" style={{ fontSize: 8 }}>06:00</text>
        <text x={center} y={size - 2} textAnchor="middle" className="fill-label-quaternary" style={{ fontSize: 8 }}>12:00</text>
        <text x={4} y={center + 3} textAnchor="start" className="fill-label-quaternary" style={{ fontSize: 8 }}>18:00</text>
      </svg>
    </div>
  );
}

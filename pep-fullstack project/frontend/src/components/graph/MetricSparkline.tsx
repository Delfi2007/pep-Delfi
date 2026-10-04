"use client";

export function MetricSparkline({
  label,
  value,
  series,
  color = "var(--accent-blue)",
  width = 200,
  height = 40,
}: {
  label: string;
  value: string;
  series: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...series);
  const min = Math.min(0, ...series);
  const range = max - min || 1;
  const step = series.length > 1 ? width / (series.length - 1) : width;

  const points = series
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <div className="rounded-xl border border-separator bg-surface px-3 py-2.5">
      <p className="text-[11px] text-label-tertiary">{label}</p>
      <p className="text-[20px] font-semibold text-label-primary">{value}</p>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-1">
        <polygon points={areaPoints} fill={color} opacity={0.12} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

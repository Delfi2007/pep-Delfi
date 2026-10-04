"use client";

export function MiniSparkline({
  series,
  color = "var(--accent-blue)",
  width = 60,
  height = 20,
}: {
  series: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;
  const max = Math.max(1, ...series);
  const step = width / (series.length - 1);
  const points = series
    .map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`)
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
    >
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} />
    </svg>
  );
}

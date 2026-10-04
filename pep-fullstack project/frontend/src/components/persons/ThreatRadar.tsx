"use client";

import type { SignalProfile } from "@/lib/types";

type Axis = {
  key: string;
  label: string;
  value: number;
  avg: number;
  max: number;
};

function normalise(v: number, max: number): number {
  return max > 0 ? Math.min(v / max, 1) : 0;
}

export function ThreatRadar({
  profile,
  caseAverage,
}: {
  profile: SignalProfile;
  caseAverage: {
    late_night_ratio: number;
    escalation_slope: number;
    asymmetry: number;
    messages_authored: number;
    share_authored: number;
  };
}) {
  const axes: Axis[] = [
    {
      key: "late_night",
      label: "Late-night activity",
      value: profile.late_night_ratio,
      avg: caseAverage.late_night_ratio,
      max: 1,
    },
    {
      key: "escalation",
      label: "Escalation slope",
      value: Math.max(profile.escalation_slope, 0),
      avg: Math.max(caseAverage.escalation_slope, 0),
      max: 1,
    },
    {
      key: "asymmetry",
      label: "Asymmetry",
      value: profile.asymmetry,
      avg: caseAverage.asymmetry,
      max: 1,
    },
    {
      key: "share",
      label: "Share authored",
      value: profile.asymmetry,
      avg: caseAverage.share_authored,
      max: 1,
    },
    {
      key: "messages",
      label: "Messages authored",
      value: profile.messages_authored,
      avg: caseAverage.messages_authored,
      max: Math.max(profile.messages_authored, caseAverage.messages_authored, 1),
    },
  ];

  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 100;
  const rings = [0.25, 0.5, 0.75, 1.0];
  const n = axes.length;

  function point(i: number, r: number): [number, number] {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  const profilePoints = axes
    .map((a, i) => point(i, normalise(a.value, a.max) * maxR))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  const avgPoints = axes
    .map((a, i) => point(i, normalise(a.avg, a.max) * maxR))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div className="relative mx-auto shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
          {rings.map((r) => (
            <polygon
              key={r}
              points={Array.from({ length: n }, (_, i) =>
                point(i, r * maxR).join(","),
              ).join(" ")}
              fill="none"
              stroke="var(--separator)"
              strokeWidth={0.5}
            />
          ))}

          {axes.map((_, i) => {
            const [ex, ey] = point(i, maxR);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={ex}
                y2={ey}
                stroke="var(--separator)"
                strokeWidth={0.5}
              />
            );
          })}

          <polygon
            points={avgPoints}
            fill="var(--accent-blue)"
            fillOpacity={0.08}
            stroke="var(--accent-blue)"
            strokeWidth={1}
            strokeDasharray="4 2"
          />

          <polygon
            points={profilePoints}
            fill="var(--accent-red)"
            fillOpacity={0.15}
            stroke="var(--accent-red)"
            strokeWidth={1.5}
          />

          {axes.map((a, i) => {
            const [px, py] = point(i, normalise(a.value, a.max) * maxR);
            return (
              <circle key={i} cx={px} cy={py} r={3} fill="var(--accent-red)" />
            );
          })}

          {axes.map((a, i) => {
            const [lx, ly] = point(i, maxR + 18);
            return (
              <text
                key={i}
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-label-tertiary"
                style={{ fontSize: 9 }}
              >
                {a.label}
              </text>
            );
          })}

          {axes.map((a, i) => {
            const [vx, vy] = point(i, maxR + 30);
            const display =
              a.key === "messages"
                ? String(Math.round(a.value))
                : a.key === "late_night"
                  ? `${Math.round(a.value * 100)}%`
                  : a.value.toFixed(2);
            return (
              <text
                key={`v-${i}`}
                x={vx}
                y={vy}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-label-primary"
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {display}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex-1">
        <div className="mb-3 flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-label-tertiary">
            <span className="inline-block size-2 rounded-full bg-accent-red" />
            {profile.label}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-label-tertiary">
            <span
              className="inline-block size-2 rounded-full border border-accent-blue"
              style={{ borderStyle: "dashed" }}
            />
            Case average
          </span>
        </div>

        <h4 className="text-[14px] font-semibold text-label-primary">What this means</h4>
        <ul className="mt-2 flex flex-col gap-3">
          {profile.late_night_ratio >= 0.15 && (
            <Insight
              icon="🌙"
              title="High late-night activity"
              text={`Most conversations happen between ${profile.peak_hours ?? "22:00 and 02:59"}.`}
            />
          )}
          {profile.escalation_slope > 0.2 && (
            <Insight
              icon="📈"
              title="Escalation pattern"
              text="Rapid increase in directive / sexualized content."
            />
          )}
          {profile.asymmetry >= 0.45 && (
            <Insight
              icon="👥"
              title="Low reciprocity"
              text="He sends more, others respond less (asymmetry high)."
            />
          )}
          {profile.counterparties.length >= 3 && (
            <Insight
              icon="🎯"
              title="Drives the conversation"
              text="Majority of messages is initiated by this actor."
            />
          )}
          {profile.late_night_ratio < 0.15 &&
            profile.escalation_slope <= 0.2 &&
            profile.asymmetry < 0.45 &&
            profile.counterparties.length < 3 && (
              <Insight
                icon="ℹ️"
                title="Within normal range"
                text="No single axis is dramatically elevated."
              />
            )}
        </ul>

        <button
          className="mt-4 text-[13px] font-medium text-accent-blue"
          onClick={() => {}}
        >
          View supporting evidence →
        </button>
      </div>
    </div>
  );
}

function Insight({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 text-[16px]">{icon}</span>
      <div>
        <p className="text-[13px] font-semibold text-label-primary">{title}</p>
        <p className="text-[12px] text-label-secondary">{text}</p>
      </div>
    </li>
  );
}

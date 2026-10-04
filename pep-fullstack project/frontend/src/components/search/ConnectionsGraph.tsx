"use client";

import type { SearchHit } from "@/lib/types";

type ResultNode = {
  id: string;
  label: string;
  type: string;
  source: string;
  x: number;
  y: number;
};

type ResultEdge = {
  from: string;
  to: string;
  relation: string;
  label: string;
};

const SOURCE_COLORS: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  call: "#007AFF",
  browser: "#AF52DE",
};

function sourceColor(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("whatsapp")) return SOURCE_COLORS.whatsapp;
  if (s.includes("instagram")) return SOURCE_COLORS.instagram;
  if (s.includes("call")) return SOURCE_COLORS.call;
  return SOURCE_COLORS.browser;
}

function timeDiff(t1: string, t2: string): string {
  const d1 = new Date(t1).getTime();
  const d2 = new Date(t2).getTime();
  const diffMs = Math.abs(d2 - d1);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function ConnectionsGraph({
  results,
}: {
  results: SearchHit[];
}) {
  if (results.length < 2) return null;

  const top = results.slice(0, 6);
  const width = 320;
  const height = 200;
  const cx = width / 2;
  const cy = height / 2;

  const nodes: ResultNode[] = top.map((r, i) => {
    const angle = (i / top.length) * 2 * Math.PI - Math.PI / 2;
    const rx = 110;
    const ry = 70;
    return {
      id: r.artifact_id,
      label: r.artifact_id,
      type: r.type,
      source: r.source,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  });

  const edges: ResultEdge[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i];
      const b = top[j];
      const sharedActors = a.actors.filter((ac) => b.actors.includes(ac));
      if (sharedActors.length > 0) {
        const diff = timeDiff(a.time, b.time);
        const sameSource = a.source === b.source;
        edges.push({
          from: a.artifact_id,
          to: b.artifact_id,
          relation: sameSource ? "Same thread" : "Correlated",
          label: diff,
        });
      }
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-label-primary">
        Connections between results
      </h3>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 h-auto w-full"
      >
        {edges.map((e, i) => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) return null;
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          const dashArray =
            e.relation === "Same thread"
              ? "none"
              : e.relation === "Correlated"
                ? "4 3"
                : "2 3";
          return (
            <g key={i}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--separator)"
                strokeWidth={1}
                strokeDasharray={dashArray}
              />
              <text
                x={mx}
                y={my - 4}
                textAnchor="middle"
                className="fill-label-quaternary"
                style={{ fontSize: 6 }}
              >
                {e.relation}
              </text>
              <text
                x={mx}
                y={my + 5}
                textAnchor="middle"
                className="fill-label-tertiary"
                style={{ fontSize: 7, fontWeight: 500 }}
              >
                ({e.label})
              </text>
            </g>
          );
        })}

        {nodes.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={14}
              fill={sourceColor(n.source)}
              opacity={0.15}
            />
            <circle
              cx={n.x}
              cy={n.y}
              r={10}
              fill={sourceColor(n.source)}
              opacity={0.9}
            />
            <text
              x={n.x}
              y={n.y + 3}
              textAnchor="middle"
              fill="white"
              style={{ fontSize: 6, fontWeight: 600 }}
            >
              {n.label.replace("a_", "")}
            </text>
            <text
              x={n.x}
              y={n.y + 24}
              textAnchor="middle"
              className="fill-label-tertiary"
              style={{ fontSize: 7 }}
            >
              {n.source.includes("whatsapp")
                ? "WhatsApp"
                : n.source.includes("instagram")
                  ? "Instagram"
                  : n.source.includes("call")
                    ? "Call"
                    : "Browser"}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-3 text-[9px] text-label-tertiary">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-label-tertiary" />
          Same thread
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-label-tertiary" />
          Correlated
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dotted border-label-tertiary" />
          Temporal proximity
        </span>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { GraphData, SignalProfile } from "@/lib/types";
import type { ActorIndex } from "@/lib/actorColors";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * A small radial view of who the top actor reaches, and over which
 * channels — the case's headline finding at a glance, without leaving the
 * People tab for the full graph.
 *
 * Drawn from the same `/graph` payload the Graph view uses, so the two
 * cannot disagree about who is connected to whom. Node colours come from
 * the shared `ActorIndex`, so a name is the same colour here, on the
 * timeline and in the graph.
 *
 * It renders only the top actor's immediate neighbourhood: this is a
 * summary card, and a full force layout at this size is unreadable. The
 * link through to the Graph view is how you see the rest.
 */
export function ConnectionsCard({
  graph,
  profile,
  actorIndex,
  onOpenGraph,
}: {
  graph: GraphData | null;
  /** The highest-ranked actor — the centre of the diagram. */
  profile: SignalProfile | undefined;
  actorIndex: ActorIndex;
  onOpenGraph: () => void;
}) {
  const [mode, setMode] = useState<"people" | "platforms">("people");

  const centre = useMemo(() => {
    if (!graph || !profile) return null;
    return graph.nodes.find((n) => n.actor_id === profile.actor_id) ?? null;
  }, [graph, profile]);

  const neighbours = useMemo(() => {
    if (!graph || !centre) return [];
    const byId = new Map(graph.nodes.map((n) => [n.actor_id, n]));
    return graph.edges
      .filter((e) => e.source === centre.actor_id || e.target === centre.actor_id)
      .map((e) => {
        const otherId = e.source === centre.actor_id ? e.target : e.source;
        return { node: byId.get(otherId), edge: e };
      })
      .filter((n): n is { node: NonNullable<typeof n.node>; edge: typeof n.edge } =>
        Boolean(n.node),
      )
      .sort((a, b) => b.edge.artifact_count - a.edge.artifact_count)
      .slice(0, 6);
  }, [graph, centre]);

  if (!graph || !profile || !centre) {
    return (
      <CardShell mode={mode} onModeChange={setMode} onOpenGraph={onOpenGraph}>
        <p className="py-8 text-center text-[13px] text-label-tertiary">
          No connections to show.
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell mode={mode} onModeChange={setMode} onOpenGraph={onOpenGraph}>
      {mode === "people" ? (
        <RadialGraph
          centreLabel={centre.label}
          centreColor={actorIndex.color(profile.identifiers[0] ?? "")}
          neighbours={neighbours.map((n) => ({
            label: n.node.label,
            color: actorIndex.color(n.node.actor_id),
            count: n.edge.artifact_count,
          }))}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-separator">
          {profile.channels.map((channel) => (
            <li key={channel} className="flex items-center justify-between gap-3 py-2.5">
              <PlatformBadge platform={platformFromSource(channel)} size={14} />
              <span className="font-mono text-[11px] text-label-tertiary">{channel}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function CardShell({
  mode,
  onModeChange,
  onOpenGraph,
  children,
}: {
  mode: "people" | "platforms";
  onModeChange: (mode: "people" | "platforms") => void;
  onOpenGraph: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-label-primary">Connections</h3>
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "people", label: "People" },
            { value: "platforms", label: "Platforms" },
          ]}
        />
      </div>
      <div className="mt-3">{children}</div>
      <button
        onClick={onOpenGraph}
        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent-blue"
      >
        View full graph →
      </button>
    </section>
  );
}

/**
 * Hand-laid radial SVG rather than a force simulation: with one centre and
 * at most six neighbours, a deterministic ring is both cheaper and more
 * legible than d3-force settling into a random arrangement each render.
 */
function RadialGraph({
  centreLabel,
  centreColor,
  neighbours,
}: {
  centreLabel: string;
  centreColor: string;
  neighbours: { label: string; color: string; count: number }[];
}) {
  const width = 300;
  const height = 190;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 68;

  const placed = neighbours.map((n, i) => {
    // Start at the top and go clockwise; the -90° offset puts the first
    // neighbour above the centre rather than to its right.
    const angle = (i / Math.max(neighbours.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return {
      ...n,
      x: cx + radius * Math.cos(angle) * 1.35,
      y: cy + radius * Math.sin(angle) * 0.82,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${centreLabel} connected to ${neighbours.map((n) => n.label).join(", ")}`}
    >
      {placed.map((n) => (
        <line
          key={`edge-${n.label}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
          stroke="var(--separator)"
          strokeWidth={1}
        />
      ))}

      {placed.map((n) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r={9} fill={n.color} />
          <text
            x={n.x}
            y={n.y + 22}
            textAnchor="middle"
            className="fill-[var(--label-tertiary)] text-[8px]"
          >
            {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
          </text>
        </g>
      ))}

      <circle cx={cx} cy={cy} r={15} fill={centreColor} />
      <text
        x={cx}
        y={cy + 30}
        textAnchor="middle"
        className="fill-[var(--label-secondary)] text-[9px] font-medium"
      >
        {centreLabel}
      </text>
    </svg>
  );
}

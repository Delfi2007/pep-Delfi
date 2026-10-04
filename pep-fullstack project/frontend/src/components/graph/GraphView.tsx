"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Flag,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Link2,
} from "lucide-react";
import type { Artifact, GraphData, GraphNode, ResolvedActor, SignalProfile } from "@/lib/types";
import { iconMarkup, kindColor, KIND_LABELS } from "@/lib/graphIcons";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";
import { edgeColorForChannel, edgeLabelForChannel, PLATFORM_LEGEND } from "@/lib/graphPlatformColors";
import { riskColor } from "@/lib/riskColor";
import { buildActorIndex } from "@/lib/actorColors";
import { avatarUrl, avatarColor, avatarInitial } from "@/lib/avatars";
import { getJson } from "@/lib/fetchJson";
import { previewFor, type ContentMap } from "@/lib/artifactPreview";
import { formatDayHeader, formatTime } from "@/lib/timelineGrouping";
import { categoryLabel, senderRecipient } from "@/lib/timelineDisplay";
import { CONCERN_THRESHOLD } from "@/components/persons/PersonsView";
import { TimeOfDayRing } from "@/components/graph/TimeOfDayRing";
import { MetricSparkline } from "@/components/graph/MetricSparkline";

type SimNode = GraphNode & d3.SimulationNodeDatum;
type ChannelLink = d3.SimulationLinkDatum<SimNode> & {
  channel: string;
  count: number;
  weight: number;
  offsetIndex: number;
  offsetTotal: number;
  first_seen: string | null;
};

type ViewMode = "overview" | "investigation" | "clusters";
type DisplayFilter = "all" | "message" | "call" | "group" | "media";
type Granularity = "day" | "week" | "month";

function nodeRadius(d: GraphNode) {
  return 16 + d.degree * 6;
}

function channelMatchesDisplay(channel: string, filter: DisplayFilter): boolean {
  if (filter === "all") return true;
  const c = channel.toLowerCase();
  if (filter === "message") return c.includes("whatsapp") || c.includes("instagram");
  if (filter === "call") return c.includes("call_log");
  if (filter === "media") return c.includes("images");
  return true;
}

function bucketKey(iso: string, granularity: Granularity): string {
  const d = new Date(iso);
  if (granularity === "day") return iso.slice(0, 10);
  if (granularity === "week") {
    const day = new Date(d);
    day.setUTCDate(day.getUTCDate() - day.getUTCDay());
    return day.toISOString().slice(0, 10);
  }
  return iso.slice(0, 7);
}

export function GraphView({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [identities, setIdentities] = useState<ResolvedActor[] | null>(null);
  const [content, setContent] = useState<ContentMap | null>(null);
  const [profiles, setProfiles] = useState<SignalProfile[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [relevantOnly, setRelevantOnly] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [granularity, setGranularity] = useState<Granularity>("day");

  // Temporal playback
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const nodeSelRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkSelRef = useRef<d3.Selection<SVGLineElement, ChannelLink, SVGGElement, unknown> | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<GraphData>(`/api/cases/${caseId}/graph`),
      getJson<Artifact[]>(`/api/cases/${caseId}/artifacts`),
      getJson<ResolvedActor[]>(`/api/cases/${caseId}/identities`),
      getJson<ContentMap>(`/api/cases/${caseId}/content`),
      getJson<SignalProfile[]>(`/api/cases/${caseId}/signals`),
    ])
      .then(([g, a, i, c, sig]) => {
        setData(g);
        setArtifacts(a);
        setIdentities(i);
        setContent(c);
        setProfiles(sig);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? `Failed to load graph — ${err.message}` : "Failed to load graph",
        ),
      );
  }, [caseId]);

  const actorIndex = useMemo(() => (identities ? buildActorIndex(identities) : null), [identities]);
  const profileByActor = useMemo(() => new Map(profiles.map((p) => [p.actor_id, p])), [profiles]);

  const availableChannels = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const e of data.edges) {
      for (const ch of Object.keys(e.channel_counts)) set.add(ch);
    }
    return Array.from(set).sort();
  }, [data]);

  // --- Time range for playback ------------------------------------------
  const timeRange = useMemo(() => {
    if (!data) return null;
    const times: number[] = [];
    for (const n of data.nodes) {
      if (n.first_seen) times.push(Date.parse(n.first_seen));
      if (n.last_seen) times.push(Date.parse(n.last_seen));
    }
    for (const e of data.edges) {
      if (e.first_seen) times.push(Date.parse(e.first_seen));
      if (e.last_seen) times.push(Date.parse(e.last_seen));
    }
    if (times.length === 0) return null;
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [data]);

  useEffect(() => {
    if (timeRange && currentTime === null) setCurrentTime(timeRange.max);
  }, [timeRange, currentTime]);

  useEffect(() => {
    if (!isPlaying || !timeRange) return;
    playTimerRef.current = setInterval(() => {
      setCurrentTime((t) => {
        if (t === null) return timeRange.max;
        const stepMs = ((timeRange.max - timeRange.min) / 200) * speed;
        const next = t + stepMs;
        if (next >= timeRange.max) {
          setIsPlaying(false);
          return timeRange.max;
        }
        return next;
      });
    }, 100);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, speed, timeRange]);

  // --- Initialize investigation mode on the highest-risk node -----------
  useEffect(() => {
    if (viewMode !== "investigation" || !data) return;
    if (expandedNodes.size > 0) return;
    const top = [...data.nodes].sort((a, b) => b.risk_score - a.risk_score)[0];
    if (top) setExpandedNodes(new Set([top.actor_id]));
  }, [viewMode, data, expandedNodes.size]);

  function expandFrom(actorId: string) {
    if (!data) return;
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.add(actorId);
      for (const e of data.edges) {
        if (e.source === actorId) next.add(e.target);
        if (e.target === actorId) next.add(e.source);
      }
      return next;
    });
  }

  // --- Filtered node/edge set (mode + display + platform + relevance) ---
  const { visibleNodes, channelLinks, components } = useMemo(() => {
    if (!data) return { visibleNodes: [] as GraphNode[], channelLinks: [] as ChannelLink[], components: new Map<string, number>() };

    let nodeSet = new Set(data.nodes.map((n) => n.actor_id));
    if (viewMode === "investigation") nodeSet = expandedNodes;

    if (displayFilter === "group") {
      const groupIds = new Set(data.nodes.filter((n) => n.kind === "group").map((n) => n.actor_id));
      const connected = new Set<string>();
      for (const e of data.edges) {
        if (groupIds.has(e.source)) connected.add(e.target);
        if (groupIds.has(e.target)) connected.add(e.target);
      }
      nodeSet = new Set([...nodeSet].filter((id) => groupIds.has(id) || connected.has(id)));
    }

    if (relevantOnly) {
      const relevant = new Set(
        data.nodes.filter((n) => n.risk_score >= CONCERN_THRESHOLD || n.flagged).map((n) => n.actor_id),
      );
      const connected = new Set<string>();
      for (const e of data.edges) {
        if (relevant.has(e.source)) connected.add(e.target);
        if (relevant.has(e.target)) connected.add(e.source);
      }
      nodeSet = new Set([...nodeSet].filter((id) => relevant.has(id) || connected.has(id)));
    }

    const links: ChannelLink[] = [];
    for (const e of data.edges) {
      if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
      const entries = Object.entries(e.channel_counts).filter(
        ([ch]) =>
          channelMatchesDisplay(ch, displayFilter) &&
          (platformFilter === "all" || ch === platformFilter),
      );
      entries.forEach(([channel, count], i) => {
        links.push({
          source: e.source,
          target: e.target,
          channel,
          count,
          weight: e.weight,
          offsetIndex: i,
          offsetTotal: entries.length,
          first_seen: e.first_seen,
        });
      });
    }

    // Connected components (over the visible link set) for cluster mode.
    const parent = new Map<string, string>();
    function find(x: string): string {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    for (const id of nodeSet) parent.set(id, id);
    for (const l of links) union(l.source as string, l.target as string);
    const compIndex = new Map<string, number>();
    let idx = 0;
    const rootToIdx = new Map<string, number>();
    for (const id of nodeSet) {
      const root = find(id);
      if (!rootToIdx.has(root)) rootToIdx.set(root, idx++);
      compIndex.set(id, rootToIdx.get(root)!);
    }

    return {
      visibleNodes: data.nodes.filter((n) => nodeSet.has(n.actor_id)),
      channelLinks: links,
      components: compIndex,
    };
  }, [data, viewMode, expandedNodes, displayFilter, platformFilter, relevantOnly]);

  const selectedArtifacts = useMemo(() => {
    if (!selected || !artifacts || !actorIndex) return [];
    return artifacts
      .filter((a) => a.actors.some((id) => actorIndex.resolve(id)?.actor_id === selected.actor_id))
      .sort((a, b) => b.time.value.localeCompare(a.time.value));
  }, [selected, artifacts, actorIndex]);

  const topTargets = useMemo(() => {
    if (!selected || !data) return [];
    const byNode = new Map<string, number>();
    for (const e of data.edges) {
      if (e.source === selected.actor_id) byNode.set(e.target, (byNode.get(e.target) ?? 0) + e.artifact_count);
      if (e.target === selected.actor_id) byNode.set(e.source, (byNode.get(e.source) ?? 0) + e.artifact_count);
    }
    const nodeById = new Map(data.nodes.map((n) => [n.actor_id, n]));
    return Array.from(byNode.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([id, count]) => ({ node: nodeById.get(id), count }))
      .filter((x): x is { node: GraphNode; count: number } => !!x.node);
  }, [selected, data]);

  const riskFactors = useMemo(() => {
    if (!selected) return [];
    const profile = profileByActor.get(selected.actor_id);
    const factors: string[] = [];
    if (selected.late_night_pct >= 20) factors.push(`Late-night activity (${selected.late_night_pct.toFixed(0)}%)`);
    if (profile) {
      const counterpartCount = profile.counterparties.length;
      if (counterpartCount >= 3) factors.push(`Contact with ${counterpartCount} minors`);
      if ((profile.signal_counts.isolation ?? 0) > 0) factors.push("Isolation language detected");
      if ((profile.signal_counts.channel_migration ?? 0) > 0) factors.push("Channel migration requests");
      if ((profile.signal_counts.age_probe ?? 0) > 0) factors.push("Age probing questions");
      if (profile.escalation_slope > 0.2) factors.push("Escalating contact pattern");
    }
    if (selected.degree >= 3) factors.push("Cross-platform grooming pattern");
    if (selected.bridge) factors.push("Sole connector across otherwise separate groups");
    return factors;
  }, [selected, profileByActor]);

  // --- Bottom metric sparklines -------------------------------------------
  const sparklineData = useMemo(() => {
    if (!artifacts || !data) return null;
    const buckets = new Map<string, { artifacts: number; lateNight: number }>();
    for (const a of artifacts) {
      const key = bucketKey(a.time.value, granularity);
      const b = buckets.get(key) ?? { artifacts: 0, lateNight: 0 };
      b.artifacts++;
      const hour = parseInt(a.time.value.slice(11, 13), 10);
      if (hour >= 22 || hour <= 2) b.lateNight++;
      buckets.set(key, b);
    }
    const nodeBuckets = new Map<string, number>();
    for (const n of data.nodes) {
      if (!n.first_seen) continue;
      const key = bucketKey(n.first_seen, granularity);
      nodeBuckets.set(key, (nodeBuckets.get(key) ?? 0) + 1);
    }

    const sortedKeys = Array.from(buckets.keys()).sort();
    let cumulativeNodes = 0;
    const nodesOverTime: number[] = [];
    const messages: number[] = [];
    const lateNightPct: number[] = [];
    const interactions: number[] = [];

    for (const k of sortedKeys) {
      cumulativeNodes += nodeBuckets.get(k) ?? 0;
      nodesOverTime.push(cumulativeNodes);
      const b = buckets.get(k)!;
      messages.push(b.artifacts);
      lateNightPct.push(b.artifacts > 0 ? (b.lateNight / b.artifacts) * 100 : 0);
      interactions.push(b.artifacts);
    }

    return {
      nodesOverTime,
      messages,
      lateNightPct,
      interactions,
      totalNodes: data.nodes.length,
      totalMessages: artifacts.length,
      avgLateNight:
        lateNightPct.length > 0 ? lateNightPct.reduce((a, b) => a + b, 0) / lateNightPct.length : 0,
    };
  }, [artifacts, data, granularity]);

  // --- D3 render ----------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (visibleNodes.length === 0) return;

    const width = containerRef.current.clientWidth || 900;
    const height = containerRef.current.clientHeight || 600;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const defs = svg.append("defs");
    visibleNodes.forEach((n) => {
      if (n.kind === "person" || n.kind === "handle") {
        const clip = defs.append("clipPath").attr("id", `clip-${n.actor_id}`);
        clip.append("circle").attr("r", nodeRadius(n) - 3);
      }
    });

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);
    zoomRef.current = zoom;

    const nodes: SimNode[] = visibleNodes.map((n) => ({ ...n }));
    nodesRef.current = nodes;
    const nodeById = new Map(nodes.map((n) => [n.actor_id, n]));
    const maxWeight = Math.max(1, ...channelLinks.map((l) => l.weight));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, ChannelLink>(channelLinks as unknown as ChannelLink[])
          .id((d) => d.actor_id)
          .distance(140)
          .strength(0.25),
      )
      .force("charge", d3.forceManyBody().strength(-460))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 16),
      );

    // Cluster halos (drawn first, behind everything)
    const halo = g.append("g");

    const link = g
      .append("g")
      .selectAll<SVGLineElement, ChannelLink>("line")
      .data(channelLinks)
      .join("line")
      .attr("stroke", (d) => edgeColorForChannel(d.channel))
      .attr("stroke-width", (d) => 1 + (d.weight / maxWeight) * 3.5)
      .attr("stroke-opacity", 0.65);
    linkSelRef.current = link;

    const edgeLabel = g
      .append("g")
      .selectAll("text")
      .data(channelLinks.filter((l) => l.offsetIndex === 0))
      .join("text")
      .text((d) => `${d.count}`)
      .attr("font-size", 9)
      .attr("fill", "var(--label-tertiary)")
      .attr("text-anchor", "middle")
      .style("pointer-events", "none");

    const nodeGroup = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelected(d);
        if (viewMode === "investigation") expandFrom(d.actor_id);
      })
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );
    nodeSelRef.current = nodeGroup;

    // Risk-score glow ring
    nodeGroup
      .append("circle")
      .attr("r", (d) => nodeRadius(d) + 5)
      .attr("fill", "none")
      .attr("stroke", (d) => riskColor(d.risk_score))
      .attr("stroke-width", (d) => (d.risk_score >= 0.75 ? 3 : d.risk_score >= 0.25 ? 2 : 1))
      .attr("opacity", (d) => (d.risk_score > 0 ? 0.9 : 0.25));

    // Bridge-node dashed halo
    nodeGroup
      .filter((d) => d.bridge)
      .append("circle")
      .attr("r", (d) => nodeRadius(d) + 10)
      .attr("fill", "none")
      .attr("stroke", "var(--accent-red)")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "3,3")
      .attr("opacity", 0.7);

    // Base circle (fallback fill / avatar backdrop)
    nodeGroup
      .append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => (d.kind === "person" || d.kind === "handle" ? avatarColor(d.label) : kindColor(d.kind)))
      .attr("stroke", "var(--surface)")
      .attr("stroke-width", 2);

    // Initial letter (shows until/unless the avatar photo loads on top)
    nodeGroup
      .filter((d) => d.kind === "person" || d.kind === "handle")
      .append("text")
      .text((d) => avatarInitial(d.label))
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "white")
      .attr("font-size", (d) => nodeRadius(d) * 0.7)
      .attr("font-weight", 700)
      .style("pointer-events", "none");

    // Avatar photo on top, clipped to the node circle; hidden on load error
    nodeGroup
      .filter((d) => d.kind === "person" || d.kind === "handle")
      .append("image")
      .attr("href", (d) => avatarUrl(d.label, nodeRadius(d) * 2))
      .attr("x", (d) => -nodeRadius(d) + 3)
      .attr("y", (d) => -nodeRadius(d) + 3)
      .attr("width", (d) => (nodeRadius(d) - 3) * 2)
      .attr("height", (d) => (nodeRadius(d) - 3) * 2)
      .attr("clip-path", (d) => `url(#clip-${d.actor_id})`)
      .style("pointer-events", "none")
      .on("error", function () {
        d3.select(this).style("display", "none");
      });

    // Icon glyph for non-avatar kinds (phone / group)
    nodeGroup
      .filter((d) => d.kind !== "person" && d.kind !== "handle")
      .each(function (d) {
        const r = nodeRadius(d);
        const scale = (r * 1.1) / 24;
        d3.select(this)
          .append("g")
          .attr("transform", `translate(${-12 * scale}, ${-12 * scale}) scale(${scale})`)
          .style("pointer-events", "none")
          .html(
            `<g fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(d.kind)}</g>`,
          );
      });

    if (nodes.some((n) => n.flagged)) {
      nodeGroup
        .filter((d) => d.flagged)
        .append("g")
        .attr("transform", (d) => `translate(${nodeRadius(d) * 0.6}, ${-nodeRadius(d) * 0.6})`)
        .html(
          `<circle r="8" fill="var(--accent-red)" /><g transform="translate(-4,-4) scale(0.35)" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 8 2a6 6 0 0 0 3.6-1.2A1 1 0 0 1 21 3.6V15a1 1 0 0 1-.4.8A6 6 0 0 1 16 17c-3 0-5-2-8-2a6 6 0 0 0-3.6 1.2"/></g>`,
        );
    }

    // Person-of-interest pill for high-risk nodes
    nodeGroup
      .filter((d) => d.risk_score >= CONCERN_THRESHOLD)
      .append("g")
      .attr("transform", (d) => `translate(0, ${nodeRadius(d) + 24})`)
      .append("rect")
      .attr("x", -38)
      .attr("y", -8)
      .attr("width", 76)
      .attr("height", 15)
      .attr("rx", 7.5)
      .attr("fill", "var(--accent-red)")
      .attr("opacity", 0.15)
      .attr("stroke", "var(--accent-red)")
      .attr("stroke-width", 1);

    nodeGroup
      .filter((d) => d.risk_score >= CONCERN_THRESHOLD)
      .append("text")
      .text("Person of Interest")
      .attr("x", 0)
      .attr("y", (d) => nodeRadius(d) + 30)
      .attr("text-anchor", "middle")
      .attr("font-size", 8)
      .attr("font-weight", 600)
      .attr("fill", "var(--accent-red)")
      .style("pointer-events", "none");

    const label = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => `${d.label} (${d.risk_score.toFixed(2)})`)
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("fill", "var(--label-primary)")
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .style("paint-order", "stroke")
      .style("stroke", "var(--canvas)")
      .style("stroke-width", "3px");

    function linkOffset(d: ChannelLink): { dx: number; dy: number } {
      const s = d.source as unknown as SimNode;
      const t = d.target as unknown as SimNode;
      const dx = (t.x ?? 0) - (s.x ?? 0);
      const dy = (t.y ?? 0) - (s.y ?? 0);
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const spacing = 6;
      const offset = spacing * (d.offsetIndex - (d.offsetTotal - 1) / 2);
      return { dx: nx * offset, dy: ny * offset };
    }

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => {
          const s = d.source as unknown as SimNode;
          return (s.x ?? 0) + linkOffset(d).dx;
        })
        .attr("y1", (d) => {
          const s = d.source as unknown as SimNode;
          return (s.y ?? 0) + linkOffset(d).dy;
        })
        .attr("x2", (d) => {
          const t = d.target as unknown as SimNode;
          return (t.x ?? 0) + linkOffset(d).dx;
        })
        .attr("y2", (d) => {
          const t = d.target as unknown as SimNode;
          return (t.y ?? 0) + linkOffset(d).dy;
        });
      edgeLabel
        .attr("x", (d) => {
          const s = d.source as unknown as SimNode;
          const t = d.target as unknown as SimNode;
          return ((s.x ?? 0) + (t.x ?? 0)) / 2;
        })
        .attr("y", (d) => {
          const s = d.source as unknown as SimNode;
          const t = d.target as unknown as SimNode;
          return ((s.y ?? 0) + (t.y ?? 0)) / 2;
        });
      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => (d.y ?? 0) - (nodeRadius(d) + 8));

      // Cluster halos
      if (viewMode === "clusters") {
        halo.selectAll("*").remove();
        const byComp = new Map<number, SimNode[]>();
        for (const n of nodes) {
          const c = components.get(n.actor_id) ?? 0;
          if (!byComp.has(c)) byComp.set(c, []);
          byComp.get(c)!.push(n);
        }
        const hues = ["#5856D6", "#34C759", "#FF9500", "#AF52DE", "#00C7BE", "#FF2D55"];
        for (const [comp, compNodes] of byComp) {
          if (compNodes.length < 2) continue;
          const points: [number, number][] = compNodes.map((n) => [n.x ?? 0, n.y ?? 0]);
          const hull = d3.polygonHull(points);
          if (!hull) continue;
          halo
            .append("path")
            .attr(
              "d",
              d3.line()(
                hull.map(([x, y]) => [x, y] as [number, number]),
              ) + "Z",
            )
            .attr("fill", hues[comp % hues.length])
            .attr("opacity", 0.06)
            .attr("stroke", hues[comp % hues.length])
            .attr("stroke-opacity", 0.2)
            .attr("stroke-width", 40)
            .attr("stroke-linejoin", "round");
        }
      }
    });

    return () => {
      simulation.stop();
    };
  }, [visibleNodes, channelLinks, viewMode, components]);

  // Temporal playback opacity pass — runs on a ref, no re-render of the sim.
  useEffect(() => {
    if (!nodeSelRef.current || !linkSelRef.current || currentTime === null) return;
    nodeSelRef.current.style("opacity", (d) =>
      !d.first_seen || Date.parse(d.first_seen) <= currentTime ? 1 : 0.06,
    );
    linkSelRef.current.style("opacity", (d) =>
      !d.first_seen || Date.parse(d.first_seen) <= currentTime ? 0.65 : 0.03,
    );
  }, [currentTime]);

  function zoomBy(factor: number) {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, factor);
  }

  function fitGraph() {
    if (!svgRef.current || !zoomRef.current || !containerRef.current || nodesRef.current.length === 0)
      return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const xs = nodesRef.current.map((n) => n.x ?? 0);
    const ys = nodesRef.current.map((n) => n.y ?? 0);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const scale = Math.min(2, 0.85 / Math.max(w / width, h / height));
    const tx = width / 2 - scale * (minX + maxX) / 2;
    const ty = height / 2 - scale * (minY + maxY) / 2;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!data || !content || !actorIndex || !identities) {
    return <p className="p-6 text-[13px] text-label-secondary">Loading graph…</p>;
  }

  return (
    <div className="space-y-3">
      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-label-tertiary">View mode:</span>
          <div className="flex items-center rounded-lg border border-separator bg-surface p-0.5">
            {(["overview", "investigation", "clusters"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setViewMode(m);
                  if (m === "investigation") setExpandedNodes(new Set());
                }}
                className={`rounded-md px-2.5 py-1 text-[12px] capitalize transition-colors ${
                  viewMode === m ? "bg-accent-blue text-white" : "text-label-secondary hover:bg-canvas"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-label-tertiary">Display:</span>
          <div className="flex items-center gap-0.5 rounded-lg border border-separator bg-surface p-0.5">
            {(["all", "message", "call", "group", "media"] as DisplayFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setDisplayFilter(f)}
                className={`rounded-md px-2 py-1 text-[11px] capitalize transition-colors ${
                  displayFilter === f ? "bg-accent-blue text-white" : "text-label-secondary hover:bg-canvas"
                }`}
              >
                {f === "all" ? "All" : f === "message" ? "Messages" : f === "call" ? "Calls" : f === "group" ? "Groups" : "Media"}
              </button>
            ))}
          </div>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="h-7 rounded-lg border border-separator bg-surface px-2 text-[11px] text-label-secondary"
          >
            <option value="all">All Platforms</option>
            {availableChannels.map((ch) => (
              <option key={ch} value={ch}>
                {edgeLabelForChannel(ch)}
              </option>
            ))}
          </select>

          <span className="text-[12px] text-label-tertiary">Filters:</span>
          <button
            onClick={() => setRelevantOnly((v) => !v)}
            className="flex items-center gap-1.5 text-[12px]"
          >
            <span
              className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                relevantOnly ? "bg-accent-blue" : "bg-separator"
              }`}
            >
              <span
                className={`size-4 rounded-full bg-white shadow transition-transform ${
                  relevantOnly ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
            <span className="text-label-secondary">Relevant only</span>
          </button>
        </div>
      </div>

      <div className="flex h-[70vh] gap-4">
        {/* Legend */}
        <div className="w-48 shrink-0 overflow-y-auto">
          <p className="mb-2 text-[13px] font-semibold text-label-primary">Legend</p>
          <div className="space-y-2">
            {(["person", "phone", "group", "handle"] as const).map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: kindColor(kind) }}
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: iconMarkup(kind) }} />
                </span>
                <span className="text-[12px] text-label-secondary">{KIND_LABELS[kind]}</span>
              </div>
            ))}
          </div>

          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-label-tertiary">
            Platforms (edge colors)
          </p>
          <div className="space-y-1.5">
            {PLATFORM_LEGEND.map((p) => (
              <div key={p.channel} className="flex items-center gap-2">
                <span className="h-0.5 w-5 shrink-0 rounded" style={{ backgroundColor: p.color }} />
                <span className="text-[12px] text-label-secondary">{p.label}</span>
              </div>
            ))}
          </div>

          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-label-tertiary">
            Risk score (node glow)
          </p>
          <div className="space-y-1.5">
            <LegendRisk color="var(--accent-red)" label="High (0.75 – 1.00)" />
            <LegendRisk color="#FF9500" label="Medium (0.50 – 0.74)" />
            <LegendRisk color="#FFCC00" label="Low (0.25 – 0.49)" />
            <LegendRisk color="var(--label-quaternary)" label="No data" />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="size-6 shrink-0 rounded-full border-[3px] border-dashed border-accent-red bg-canvas" />
            <span className="text-[12px] text-label-secondary">Bridge / sole connector</span>
          </div>
        </div>

        {/* Graph canvas */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => zoomBy(1.3)}
              className="flex size-8 items-center justify-center rounded-control border border-separator bg-surface text-label-secondary hover:text-label-primary"
            >
              <ZoomIn className="size-4" />
            </button>
            <button
              onClick={() => zoomBy(1 / 1.3)}
              className="flex size-8 items-center justify-center rounded-control border border-separator bg-surface text-label-secondary hover:text-label-primary"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              onClick={fitGraph}
              className="flex items-center gap-1.5 rounded-control border border-separator bg-surface px-2.5 py-1.5 text-[12px] text-label-secondary hover:text-label-primary"
            >
              <Maximize2 className="size-3.5" />
              Fit Graph
            </button>
            {viewMode === "investigation" && (
              <span className="ml-2 flex items-center gap-1 text-[11px] text-label-tertiary">
                <Link2 className="size-3" />
                Click a node to expand its connections
              </span>
            )}
          </div>

          <div ref={containerRef} className="relative flex-1 overflow-hidden rounded-control bg-canvas">
            <svg ref={svgRef} className="h-full w-full" />
          </div>

          {/* Temporal playback */}
          {timeRange && (
            <div className="flex items-center gap-3 rounded-control border border-separator bg-surface px-3 py-2">
              <button
                onClick={() => setCurrentTime(timeRange.min)}
                className="flex size-7 items-center justify-center rounded-full text-label-secondary hover:bg-canvas"
              >
                <SkipBack className="size-3.5" />
              </button>
              <button
                onClick={() => setIsPlaying((v) => !v)}
                className="flex size-8 items-center justify-center rounded-full bg-accent-blue text-white"
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                onClick={() => {
                  setCurrentTime(timeRange.max);
                  setIsPlaying(false);
                }}
                className="flex size-7 items-center justify-center rounded-full text-label-secondary hover:bg-canvas"
              >
                <SkipForward className="size-3.5" />
              </button>

              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="h-7 rounded-control border border-separator bg-canvas px-1.5 text-[11px] text-label-secondary"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>

              <div className="flex-1">
                <input
                  type="range"
                  min={timeRange.min}
                  max={timeRange.max}
                  value={currentTime ?? timeRange.max}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setCurrentTime(Number(e.target.value));
                  }}
                  className="w-full accent-accent-blue"
                />
                <div className="flex justify-between text-[10px] text-label-tertiary">
                  <span>{new Date(timeRange.min).toLocaleDateString()}</span>
                  <span className="font-medium text-label-primary">
                    {currentTime !== null ? new Date(currentTime).toLocaleDateString() : ""}
                    {currentTime === timeRange.max ? " (Now)" : ""}
                  </span>
                  <span>{new Date(timeRange.max).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom metrics */}
          {sparklineData && (
            <div className="space-y-2">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-[11px] text-label-tertiary">Time granularity:</span>
                <div className="flex items-center rounded-lg border border-separator bg-surface p-0.5">
                  {(["day", "week", "month"] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors ${
                        granularity === g ? "bg-accent-blue text-white" : "text-label-secondary"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <MetricSparkline
                  label="Nodes over time"
                  value={String(sparklineData.totalNodes)}
                  series={sparklineData.nodesOverTime}
                  color="var(--accent-blue)"
                />
                <MetricSparkline
                  label="Active interactions"
                  value={String(sparklineData.interactions.reduce((a, b) => a + b, 0))}
                  series={sparklineData.interactions}
                  color="var(--accent-green, #34C759)"
                />
                <MetricSparkline
                  label="Messages"
                  value={String(sparklineData.totalMessages)}
                  series={sparklineData.messages}
                  color="#AF52DE"
                />
                <MetricSparkline
                  label="Late-night %"
                  value={`${sparklineData.avgLateNight.toFixed(0)}%`}
                  series={sparklineData.lateNightPct}
                  color="var(--accent-red)"
                />
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="w-80 shrink-0 overflow-y-auto pl-1">
          {!selected ? (
            <p className="pt-4 text-center text-[13px] text-label-tertiary">
              Select a node to see its details
            </p>
          ) : (
            <NodeDetailPanel
              node={selected}
              profile={profileByActor.get(selected.actor_id)}
              uniqueContacts={data.edges.filter((e) => e.source === selected.actor_id || e.target === selected.actor_id).length}
              riskFactors={riskFactors}
              topTargets={topTargets}
              selectedArtifacts={selectedArtifacts}
              content={content}
              actorIndex={actorIndex}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LegendRisk({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-3.5 shrink-0 rounded-full border-2" style={{ borderColor: color }} />
      <span className="text-[12px] text-label-secondary">{label}</span>
    </div>
  );
}

function NodeDetailPanel({
  node,
  profile,
  uniqueContacts,
  riskFactors,
  topTargets,
  selectedArtifacts,
  content,
  actorIndex,
}: {
  node: GraphNode;
  profile: SignalProfile | undefined;
  uniqueContacts: number;
  riskFactors: string[];
  topTargets: { node: GraphNode; count: number }[];
  selectedArtifacts: Artifact[];
  content: ContentMap;
  actorIndex: ReturnType<typeof buildActorIndex>;
}) {
  const isPOI = node.risk_score >= CONCERN_THRESHOLD;
  const relevantInteractions = selectedArtifacts.filter((a) => a.flags.length > 0).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-white"
          style={{ background: node.kind === "person" || node.kind === "handle" ? avatarColor(node.label) : kindColor(node.kind) }}
        >
          {node.kind === "person" || node.kind === "handle" ? (
            <img src={avatarUrl(node.label, 88)} alt="" className="size-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: iconMarkup(node.kind) }} />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[15px] font-semibold text-label-primary">{node.label}</p>
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
              style={{ color: riskColor(node.risk_score), backgroundColor: `${riskColor(node.risk_score)}18` }}
            >
              {node.risk_score.toFixed(2)}
            </span>
          </div>
          {isPOI && (
            <span className="mt-0.5 inline-block rounded-full bg-accent-red/10 px-2 py-0.5 text-[10px] font-semibold text-accent-red">
              Person of Interest
            </span>
          )}
        </div>
      </div>

      <dl className="space-y-1.5 text-[12px]">
        <div className="flex items-center justify-between">
          <dt className="text-label-secondary">Type</dt>
          <dd className="text-label-primary">{KIND_LABELS[node.kind]}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-label-secondary">Platform presence</dt>
          <dd className="flex gap-1">
            {node.channels.map((ch) => (
              <PlatformBadge key={ch} platform={platformFromSource(ch)} size={14} showLabel={false} />
            ))}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Total Interactions" value={String(node.artifact_count)} />
        <Stat label="Relevant Interactions" value={String(relevantInteractions)} />
        <Stat label="First Seen" value={node.first_seen ? formatDayHeader(node.first_seen.slice(0, 10)) : "—"} />
        <Stat label="Last Seen" value={node.last_seen ? formatDayHeader(node.last_seen.slice(0, 10)) : "—"} />
      </div>

      {riskFactors.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[12px] font-semibold text-label-primary">Risk factors</p>
          <ul className="space-y-1">
            {riskFactors.map((f) => (
              <li key={f} className="flex items-start gap-1.5 text-[11px] text-accent-red">
                <Flag className="mt-0.5 size-3 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 border-t border-separator pt-3">
        <p className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-label-primary">
          Time of day activity
        </p>
        <div className="flex justify-center">
          <TimeOfDayRing hourly={node.hourly_activity} peakHours={node.peak_hours} latePct={node.late_night_pct} />
        </div>
      </div>

      {topTargets.length > 0 && (
        <div className="mt-4 border-t border-separator pt-3">
          <p className="mb-2 text-[12px] font-semibold text-label-primary">Top communication targets</p>
          <div className="space-y-1.5">
            {(() => {
              const max = Math.max(...topTargets.map((t) => t.count));
              return topTargets.slice(0, 5).map(({ node: t, count }) => (
                <div key={t.actor_id} className="flex items-center gap-2">
                  <span className="size-5 shrink-0 overflow-hidden rounded-full" style={{ background: avatarColor(t.label) }}>
                    <img src={avatarUrl(t.label, 40)} alt="" className="size-full object-cover" />
                  </span>
                  <span className="w-16 shrink-0 truncate text-[11px] text-label-primary">{t.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full bg-accent-red"
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] text-label-tertiary">{count}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-separator pt-3">
        <p className="mb-2 text-[13px] font-semibold text-label-primary">Recent Interactions</p>
        <div className="space-y-1.5">
          {selectedArtifacts.slice(0, 5).map((a) => {
            const { from, to } = senderRecipient(a, content, actorIndex);
            const counterpart = from?.actor_id === node.actor_id ? to : from;
            const flagged = a.flags.length > 0;
            return (
              <div
                key={a.artifact_id}
                className={`rounded-control border px-2.5 py-1.5 text-[12px] ${flagged ? "border-accent-amber/40 bg-accent-amber/5" : "border-separator bg-surface"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-label-tertiary">
                    {formatDayHeader(a.time.value.slice(0, 10))} {formatTime(a.time.value)}
                  </span>
                  {flagged && <Flag className="size-3 shrink-0 text-accent-amber" />}
                </div>
                <p className="truncate text-label-primary">
                  {categoryLabel(a)}
                  {counterpart ? ` with ${counterpart.label}` : ""}
                </p>
                <p className="truncate text-label-secondary">{previewFor(a, content)}</p>
              </div>
            );
          })}
          {selectedArtifacts.length === 0 && (
            <p className="text-[12px] text-label-tertiary">No interactions found</p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-separator pt-3">
        <p className="mb-2 text-[13px] font-semibold text-label-primary">
          Related Artifacts ({node.artifact_count})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {selectedArtifacts.slice(0, 8).map((a) => (
            <span key={a.artifact_id} className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-accent-blue">
              {a.artifact_id}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-separator bg-surface px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-label-tertiary">{label}</p>
      <p className="text-[15px] font-semibold text-label-primary">{value}</p>
    </div>
  );
}

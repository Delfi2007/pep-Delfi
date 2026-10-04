"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Filter,
  Flag,
  Gift,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  ArtifactType,
  ResolvedActor,
  SearchHit,
  SearchResponse,
} from "@/lib/types";
import { getJson } from "@/lib/fetchJson";
import { buildActorIndex, type ActorIndex } from "@/lib/actorColors";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";
import { formatDayHeader, formatTime } from "@/lib/timelineGrouping";
import { EvidenceMap } from "./EvidenceMap";
import { ResultsTimeline } from "./ResultsTimeline";
import { ConnectionsGraph } from "./ConnectionsGraph";

type EvidenceStats = {
  total: number;
  evidence_by_type: {
    type: string;
    label: string;
    count: number;
    pct: number;
    flagged: number;
    color: string;
  }[];
  platforms: { label: string; count: number; pct: number }[];
  suggestions: {
    id: string;
    label: string;
    icon: string;
    query: string;
    count: number;
  }[];
  timeline: {
    date: string;
    message?: number;
    image?: number;
    call?: number;
    browser_history?: number;
    flagged?: number;
  }[];
  top_evidence: {
    artifact_id: string;
    type: string;
    type_label: string;
    source: string;
    risk: string;
    flags: string[];
  }[];
  day_hour_activity: number[][];
};

const EVENT_TYPES: {
  value: ArtifactType;
  label: string;
  icon: typeof MessageCircle;
}[] = [
  { value: "message", label: "Messages", icon: MessageCircle },
  { value: "image", label: "Media", icon: ImageIcon },
  { value: "call", label: "Calls", icon: Phone },
  { value: "browser_history", label: "System Events", icon: Globe },
];

const SUGGESTION_ICONS: Record<string, typeof Search> = {
  search: Search,
  lock: Lock,
  "arrow-right": ArrowRight,
  "map-pin": MapPin,
  gift: Gift,
  flag: Flag,
};

const TYPE_ICON_MAP: Record<string, typeof MessageCircle> = {
  message: MessageCircle,
  image: ImageIcon,
  call: Phone,
  browser_history: Globe,
};

const TYPE_COLORS: Record<string, string> = {
  message: "#34C759",
  image: "#FF9500",
  call: "#007AFF",
  browser_history: "#AF52DE",
};

const SIGNAL_TAGS: Record<string, { label: string; color: string }> = {
  "hash_match:sha256": { label: "Hash match", color: "#FF3B30" },
  "hash_match:phash:0": { label: "Visual match", color: "#FF3B30" },
  isolation: { label: "Isolation", color: "#FF9500" },
  channel_migration: { label: "Channel migration", color: "#AF52DE" },
  contact_escalation: { label: "Escalation", color: "#FF3B30" },
  age_probe: { label: "Age probe", color: "#FF9500" },
  meet_in_person: { label: "Meet in person", color: "#FF6B35" },
  response: { label: "Response", color: "#007AFF" },
  plan_proposal: { label: "Plan proposal", color: "#34C759" },
  follow_up: { label: "Follow up", color: "#8E8E93" },
};

function inferSignalTag(hit: SearchHit): { label: string; color: string } | null {
  if (hit.flags.length > 0) {
    const first = hit.flags[0];
    if (SIGNAL_TAGS[first]) return SIGNAL_TAGS[first];
    if (first.startsWith("hash_match")) return { label: "Hash match", color: "#FF3B30" };
    return { label: first, color: "#FF9500" };
  }
  const text = hit.snippet.toLowerCase();
  if (/\b(?:meet|hang out|come over|pick you up|in person|coffee|my place|your place)\b/.test(text))
    return SIGNAL_TAGS.meet_in_person;
  if (/\b(?:perfect|sounds good|yes|okay|sure|definitely)\b/.test(text) && hit.actors.length >= 2)
    return SIGNAL_TAGS.response;
  if (/\b(?:saturday|sunday|tomorrow|evening|morning|when|what time)\b/.test(text))
    return SIGNAL_TAGS.plan_proposal;
  if (hit.type === "call") return SIGNAL_TAGS.follow_up;
  return null;
}

function typeLabel(type: string, source: string): string {
  const s = source.toLowerCase();
  if (type === "message") {
    if (s.includes("whatsapp")) return "WhatsApp Message";
    if (s.includes("instagram")) return "Instagram DM";
    return "Message";
  }
  if (type === "call") {
    return "Voice Call";
  }
  if (type === "image") {
    return "Image";
  }
  if (type === "browser_history") {
    return "System Event";
  }
  return type;
}

const LIMIT = 50;
const DEBOUNCE_MS = 250;
const PAGE_SIZE = 20;

export function SearchView({
  caseId,
  onSelectArtifact,
}: {
  caseId: string;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<Set<ArtifactType>>(new Set());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"relevance" | "time">("relevance");
  const [groupBy, setGroupBy] = useState<"none" | "thread">("none");
  const [aiMode, setAiMode] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [identities, setIdentities] = useState<ResolvedActor[] | null>(null);
  const [stats, setStats] = useState<EvidenceStats | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<ResolvedActor[]>(`/api/cases/${caseId}/identities`)
      .then(setIdentities)
      .catch(() => setIdentities([]));
    getJson<EvidenceStats>(`/api/cases/${caseId}/evidence-stats`)
      .then(setStats)
      .catch(() => {});
  }, [caseId]);

  const actorIndex = useMemo(
    () => (identities ? buildActorIndex(identities) : null),
    [identities],
  );

  const trimmed = query.trim();

  const runSearch = useCallback(
    async (signal: AbortSignal) => {
      const params = new URLSearchParams({ q: trimmed, limit: String(LIMIT) });
      if (types.size > 0) params.set("types", [...types].join(","));
      if (flaggedOnly) params.set("flagged_only", "true");

      try {
        const data = await getJson<SearchResponse>(
          `/api/cases/${caseId}/search?${params.toString()}`,
          { signal },
        );
        if (signal.aborted) return;
        setResponse(data);
        setError(null);
        setVisibleCount(PAGE_SIZE);
      } catch (err) {
        if (
          signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!signal.aborted) setSearching(false);
      }
    },
    [caseId, trimmed, types, flaggedOnly],
  );

  useEffect(() => {
    if (!trimmed) {
      const id = setTimeout(() => {
        setResponse(null);
        setSearching(false);
      }, 0);
      return () => clearTimeout(id);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      runSearch(controller.signal);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, runSearch]);

  function toggleType(type: ArtifactType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleSuggestionClick(q: string, id: string) {
    if (id === "flagged_media") {
      setFlaggedOnly(true);
      setTypes(new Set(["image"]));
      setQuery("*");
    } else {
      setQuery(q);
    }
  }

  const sorted = useMemo(() => {
    if (!response) return [];
    if (sortBy === "time") {
      return [...response.results].sort(
        (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
      );
    }
    return response.results;
  }, [response, sortBy]);

  const activeFilters = types.size + (flaggedOnly ? 1 : 0);

  return (
    <div className="flex gap-5">
      {/* Main column */}
      <div className="min-w-0 flex-1 flex flex-col gap-4">
        {/* Header */}
        <header>
          <h2 className="text-[17px] font-semibold tracking-tight text-label-primary">
            Evidence search
          </h2>
          <p className="mt-0.5 text-[13px] text-label-tertiary">
            Search across all artifacts — messages, media, calls, and system
            events
          </p>
        </header>

        {/* Search bar */}
        <div className="flex items-center gap-2 rounded-xl border border-separator bg-canvas px-3.5 py-2.5 shadow-sm focus-within:border-accent-blue focus-within:ring-1 focus-within:ring-accent-blue/30">
          <Search className="size-[18px] shrink-0 text-label-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask this case anything..."
            className="min-w-0 flex-1 bg-transparent text-[15px] text-label-primary outline-none placeholder:text-label-tertiary"
          />
          {searching && (
            <Loader2 className="size-4 shrink-0 animate-spin text-accent-blue" />
          )}
          <button
            onClick={() => setAiMode(!aiMode)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              aiMode
                ? "bg-accent-blue text-white"
                : "bg-surface text-label-tertiary hover:text-label-primary"
            }`}
          >
            <Sparkles className="size-3" />
            AI-assisted
          </button>
        </div>

        {/* Smart search suggestions */}
        {stats && !trimmed && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-label-primary">
              Smart suggested searches
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {stats.suggestions.map((s) => {
                const Icon = SUGGESTION_ICONS[s.icon] ?? Search;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestionClick(s.query, s.id)}
                    className="flex items-center gap-2.5 rounded-lg border border-separator bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-blue/40 hover:bg-accent-blue/5"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-blue/10">
                      <Icon className="size-3.5 text-accent-blue" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-label-primary">
                        {s.label}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-label-tertiary">
                      {s.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Evidence map */}
        {stats && !trimmed && (
          <EvidenceMap
            blocks={stats.evidence_by_type}
            total={stats.total}
            timeline={stats.timeline}
          />
        )}

        {/* Results timeline — always show when stats available */}
        {stats && <ResultsTimeline timeline={stats.timeline} />}

        {/* Filter row */}
        {trimmed && (
          <div className="flex flex-wrap items-center gap-1.5">
            {EVENT_TYPES.map(({ value, label, icon: Icon }) => {
              const active = types.has(value);
              return (
                <button
                  key={value}
                  onClick={() => toggleType(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                    active
                      ? "bg-accent-blue text-white"
                      : "bg-canvas text-label-secondary hover:text-label-primary"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              );
            })}
            <button
              onClick={() => setFlaggedOnly((v) => !v)}
              aria-pressed={flaggedOnly}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                flaggedOnly
                  ? "bg-accent-amber text-white"
                  : "bg-canvas text-label-secondary hover:text-label-primary"
              }`}
            >
              <Flag className="size-3.5" />
              Flagged only
            </button>
            {(types.size > 0 || flaggedOnly) && (
              <button
                onClick={() => {
                  setTypes(new Set());
                  setFlaggedOnly(false);
                }}
                className="px-2 py-1.5 text-[13px] text-accent-blue"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-accent-red">{error}</p>}

        {/* Search results section */}
        {trimmed && response && response.total > 0 && (
          <div className="flex flex-col gap-3">
            {/* Search results header with controls */}
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-label-primary">
                Search results{" "}
                <span className="font-normal text-label-tertiary">
                  ({response.total} results)
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] text-label-tertiary">
                  Sort by:
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as "relevance" | "time")
                    }
                    className="rounded-md border border-separator bg-canvas px-2 py-1 text-[12px] text-label-primary outline-none"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="time">Time</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[12px] text-label-tertiary">
                  Group by:
                  <select
                    value={groupBy}
                    onChange={(e) =>
                      setGroupBy(e.target.value as "none" | "thread")
                    }
                    className="rounded-md border border-separator bg-canvas px-2 py-1 text-[12px] text-label-primary outline-none"
                  >
                    <option value="none">None</option>
                    <option value="thread">Thread</option>
                  </select>
                </label>
                {activeFilters > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-accent-blue/10 px-2.5 py-1 text-[11px] font-medium text-accent-blue">
                    <Filter className="size-3" />
                    Filters ({activeFilters})
                  </span>
                )}
              </div>
            </div>

            {/* Two-column: results + connections graph */}
            <div className="flex gap-4">
              {/* Results list */}
              <div className="min-w-0 flex-1">
                <ul className="flex flex-col gap-1.5">
                  {sorted.slice(0, visibleCount).map((hit, idx) => (
                    <ResultRow
                      key={hit.artifact_id}
                      hit={hit}
                      index={idx + 1}
                      actorIndex={actorIndex}
                      onSelect={onSelectArtifact}
                    />
                  ))}
                </ul>

                {/* Load more button */}
                {visibleCount < sorted.length && (
                  <button
                    onClick={() =>
                      setVisibleCount((v) => Math.min(v + PAGE_SIZE, sorted.length))
                    }
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-separator bg-surface py-2.5 text-[13px] font-medium text-label-secondary transition-colors hover:border-accent-blue/40 hover:text-accent-blue"
                  >
                    Load more results
                    <ChevronRight className="size-3.5 rotate-90" />
                  </button>
                )}
              </div>

              {/* Inline connections graph */}
              {sorted.length >= 2 && (
                <div className="hidden w-[320px] shrink-0 xl:block">
                  <ConnectionsGraph results={sorted} />
                </div>
              )}
            </div>
          </div>
        )}

        {trimmed && response && response.total === 0 && (
          <p className="py-12 text-center text-[13px] text-label-tertiary">
            No artifact matches{" "}
            {response.terms.map((t) => `"${t}"`).join(" + ")}.
          </p>
        )}
      </div>

      {/* Right sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 xl:flex">
        {/* AI Answer */}
        {response && response.total > 0 && aiMode && (
          <AiAnswerPanel results={response.results} />
        )}

        {/* Evidence over time heatmap */}
        {stats && <EvidenceHeatmap dayHour={stats.day_hour_activity} />}

        {/* Top evidence by risk */}
        {stats && stats.top_evidence.length > 0 && (
          <TopEvidenceList
            items={stats.top_evidence}
            onSelect={onSelectArtifact}
          />
        )}

        {/* Cross-platform distribution */}
        {stats && <PlatformDistribution platforms={stats.platforms} />}
      </aside>
    </div>
  );
}

function AiAnswerPanel({ results }: { results: SearchHit[] }) {
  const top = results.slice(0, 5);
  const flaggedCount = top.filter((r) => r.flags.length > 0).length;
  const actors = [...new Set(top.flatMap((r) => r.actors))];
  const sources = [...new Set(top.map((r) => r.source))];

  return (
    <section className="rounded-card border border-accent-blue/30 bg-accent-blue/5 p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-accent-blue" />
        <h3 className="text-[13px] font-semibold text-accent-blue">
          AI Answer
        </h3>
        <span className="rounded-full bg-accent-blue/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent-blue">
          Beta
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-label-secondary">
        Found <strong>{results.length}</strong> matching artifacts
        {flaggedCount > 0 && (
          <>
            ,{" "}
            <strong className="text-accent-amber">
              {flaggedCount} flagged
            </strong>
          </>
        )}
        . Involves <strong>{actors.length}</strong> actor
        {actors.length !== 1 && "s"} across <strong>{sources.length}</strong>{" "}
        source{sources.length !== 1 && "s"}.
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {top.slice(0, 3).map((r) => (
          <span
            key={r.artifact_id}
            className="rounded bg-accent-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue"
          >
            {r.artifact_id}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-label-quaternary">
        AI-generated summary based on top results. Verify with source evidence.
      </p>
    </section>
  );
}

function EvidenceHeatmap({ dayHour }: { dayHour: number[][] }) {
  if (!dayHour || dayHour.length === 0) return null;

  const maxVal = Math.max(1, ...dayHour.flat());
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cellW = 10;
  const cellH = 10;
  const gap = 1;
  const labelW = 28;
  const labelH = 14;
  const svgW = labelW + 24 * (cellW + gap);
  const svgH = labelH + 7 * (cellH + gap);

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-label-primary">
        Evidence over time
      </h3>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="mt-2 h-auto w-full"
      >
        {[0, 6, 12, 18].map((h) => (
          <text
            key={h}
            x={labelW + h * (cellW + gap) + cellW / 2}
            y={10}
            textAnchor="middle"
            className="fill-label-quaternary"
            style={{ fontSize: 6 }}
          >
            {h.toString().padStart(2, "0")}
          </text>
        ))}
        {days.map((day, di) => (
          <g key={day}>
            <text
              x={0}
              y={labelH + di * (cellH + gap) + cellH / 2 + 3}
              className="fill-label-quaternary"
              style={{ fontSize: 6 }}
            >
              {day}
            </text>
            {Array.from({ length: 24 }, (_, hi) => {
              const count = dayHour[di]?.[hi] ?? 0;
              const intensity = count / maxVal;
              const isLateNight = hi >= 22 || hi <= 2;
              const hue = isLateNight ? 0 : 220;
              const sat = isLateNight ? 80 : 70;
              const fill =
                count === 0
                  ? "var(--canvas)"
                  : `hsl(${hue}, ${sat}%, ${70 - intensity * 40}%)`;
              return (
                <rect
                  key={hi}
                  x={labelW + hi * (cellW + gap)}
                  y={labelH + di * (cellH + gap)}
                  width={cellW}
                  height={cellH}
                  rx={2}
                  fill={fill}
                >
                  <title>
                    {day} {hi}:00 — {count} artifact
                    {count !== 1 ? "s" : ""}
                  </title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-label-quaternary">
        <span>Low</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
            <span
              key={v}
              className="inline-block size-2 rounded-sm"
              style={{
                backgroundColor: `hsl(220, 70%, ${70 - v * 40}%)`,
              }}
            />
          ))}
        </div>
        <span>High</span>
        <span className="ml-2 flex items-center gap-1">
          <span
            className="inline-block size-2 rounded-sm"
            style={{ backgroundColor: "hsl(0, 80%, 50%)" }}
          />
          Late-night
        </span>
      </div>
    </section>
  );
}

function TopEvidenceList({
  items,
  onSelect,
}: {
  items: EvidenceStats["top_evidence"];
  onSelect?: (id: string) => void;
}) {
  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-label-primary">
        Top evidence by risk
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.artifact_id}>
            <button
              onClick={() => onSelect?.(item.artifact_id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-canvas"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${
                  item.risk === "High" ? "bg-accent-red" : "bg-accent-amber"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-label-primary">
                  {item.artifact_id}
                </p>
                <p className="text-[10px] text-label-tertiary">
                  {item.type_label} · {item.flags.join(", ")}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  item.risk === "High"
                    ? "bg-accent-red/15 text-accent-red"
                    : "bg-accent-amber/15 text-accent-amber"
                }`}
              >
                {item.risk}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlatformDistribution({
  platforms,
}: {
  platforms: EvidenceStats["platforms"];
}) {
  const maxCount = Math.max(1, ...platforms.map((p) => p.count));

  const COLORS: Record<string, string> = {
    WhatsApp: "#25D366",
    Instagram: "#E1306C",
    Calls: "#007AFF",
    Others: "#AF52DE",
  };

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-label-primary">
        Cross-platform distribution
      </h3>
      <ul className="mt-2.5 flex flex-col gap-2">
        {platforms.map((p) => (
          <li key={p.label}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-label-primary">{p.label}</span>
              <span className="text-label-tertiary">
                {p.count} ({p.pct}%)
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-canvas">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(p.count / maxCount) * 100}%`,
                  backgroundColor: COLORS[p.label] ?? "#8E8E93",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultRow({
  hit,
  index,
  actorIndex,
  onSelect,
}: {
  hit: SearchHit;
  index: number;
  actorIndex: ActorIndex | null;
  onSelect?: (artifactId: string) => void;
}) {
  const flagged = hit.flags.length > 0;
  const signalTag = inferSignalTag(hit);
  const TypeIcon = TYPE_ICON_MAP[hit.type] ?? Globe;
  const typeColor = TYPE_COLORS[hit.type] ?? "#8E8E93";
  const label = typeLabel(hit.type, hit.source);

  return (
    <li>
      <button
        onClick={() => onSelect?.(hit.artifact_id)}
        disabled={!onSelect}
        className={`flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors ${
          hit.tz_inferred ? "border-dashed" : "border-solid"
        } ${
          flagged
            ? "border-accent-amber/50 bg-accent-amber/5"
            : "border-separator hover:border-accent-blue/40"
        } disabled:pointer-events-none`}
      >
        {/* Index + chevron */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="w-4 text-right text-[12px] font-semibold text-label-tertiary">
            {index}
          </span>
          <ChevronRight className="size-3 text-label-quaternary" />
        </div>

        {/* Type icon */}
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${typeColor}18` }}
        >
          <TypeIcon className="size-3.5" style={{ color: typeColor }} />
        </div>

        {/* Type label + date */}
        <div className="flex w-[140px] shrink-0 flex-col">
          <span className="text-[12px] font-medium text-label-primary">
            {label}
          </span>
          <span className="font-mono text-[10px] text-label-tertiary">
            {formatDayHeader(hit.time.slice(0, 10))} {formatTime(hit.time)}
          </span>
        </div>

        {/* Actors */}
        <div className="flex w-[120px] shrink-0 flex-wrap items-center gap-0.5 text-[12px]">
          {hit.actors.map((actor, i) => (
            <span key={actor}>
              {i > 0 && (
                <ArrowRight className="mx-0.5 inline size-2.5 text-label-quaternary" />
              )}
              <span
                className="font-medium"
                style={{
                  color:
                    actorIndex?.color(actor) ?? "var(--label-secondary)",
                }}
              >
                {actorIndex?.resolve(actor)?.label ?? actor}
              </span>
            </span>
          ))}
        </div>

        {/* Snippet */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-label-secondary">
            <Highlighted text={hit.snippet} ranges={hit.highlights} />
          </p>
        </div>

        {/* Signal tag */}
        {signalTag && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: `${signalTag.color}18`,
              color: signalTag.color,
            }}
          >
            {signalTag.label}
          </span>
        )}

        {/* Artifact ID */}
        <span className="shrink-0 font-mono text-[10px] text-label-quaternary">
          {hit.artifact_id}
        </span>
      </button>
    </li>
  );
}

function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}) {
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach(([start, end], i) => {
    if (start < cursor || start >= end || end > text.length) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${start}-${i}`}
        className="rounded-[3px] bg-accent-blue/15 px-0.5 text-label-primary"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Filter,
  ZoomIn,
  ZoomOut,
  Maximize2,
  MessageCircle,
  Image as ImageIcon,
  Phone,
  Globe,
  Video,
  Mic,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import type {
  AnnotationMap,
  Artifact,
  ArtifactType,
  CorrelationMap,
  ResolvedActor,
  SignalProfile,
} from "@/lib/types";
import { buildActorIndex, type ActorIndex } from "@/lib/actorColors";
import { getJson } from "@/lib/fetchJson";
import type { ContentMap } from "@/lib/artifactPreview";
import { senderRecipient } from "@/lib/timelineDisplay";
import { CONCERN_THRESHOLD } from "@/components/persons/PersonsView";
import { ParticipantBar, Avatar } from "@/components/timeline/ParticipantBar";
import { LaneTimeline, type ZoomLevel } from "@/components/timeline/LaneTimeline";
import { SemanticTimeline } from "@/components/timeline/SemanticTimeline";
import { TimelineMinimap } from "@/components/timeline/TimelineMinimap";
import { EventDetailPanel } from "@/components/timeline/EventDetailPanel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL_TYPES: ArtifactType[] = ["message", "call", "browser_history", "image"];

const MEDIA_FILTERS: { value: ArtifactType | "all"; label: string; icon: typeof MessageCircle }[] = [
  { value: "all", label: "All", icon: Filter },
  { value: "message", label: "Text", icon: MessageCircle },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "call", label: "Call", icon: Phone },
  { value: "browser_history", label: "Browser", icon: Globe },
];

export function TimelineView({
  caseId,
  focusArtifactId,
}: {
  caseId: string;
  focusArtifactId?: string | null;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [identities, setIdentities] = useState<ResolvedActor[] | null>(null);
  const [content, setContent] = useState<ContentMap | null>(null);
  const [correlations, setCorrelations] = useState<CorrelationMap>({});
  const [annotations, setAnnotations] = useState<AnnotationMap>({});
  const [profiles, setProfiles] = useState<SignalProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    focusArtifactId ?? null,
  );
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<ZoomLevel>("day");
  const [mode, setMode] = useState<"chronological" | "semantic">("chronological");
  const [relevanceFilter, setRelevanceFilter] = useState(true);
  const [mediaFilter, setMediaFilter] = useState<ArtifactType | "all">("all");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    Promise.all([
      getJson<Artifact[]>(`/api/cases/${caseId}/artifacts`),
      getJson<ResolvedActor[]>(`/api/cases/${caseId}/identities`),
      getJson<ContentMap>(`/api/cases/${caseId}/content`),
      getJson<CorrelationMap>(`/api/cases/${caseId}/correlations`),
      getJson<AnnotationMap>(`/api/cases/${caseId}/annotations`),
      getJson<SignalProfile[]>(`/api/cases/${caseId}/signals`),
    ])
      .then(([a, i, c, corr, ann, sig]) => {
        setArtifacts(a);
        setIdentities(i);
        setContent(c);
        setCorrelations(corr);
        setAnnotations(ann);
        setProfiles(sig);
      })
      .catch((err) =>
        setError(
          err instanceof Error
            ? `Failed to load timeline — ${err.message}`
            : "Failed to load timeline",
        ),
      );
  }, [caseId]);

  const actorIndex = useMemo(
    () => (identities ? buildActorIndex(identities) : null),
    [identities],
  );
  const artifactsById = useMemo(
    () => new Map((artifacts ?? []).map((a) => [a.artifact_id, a])),
    [artifacts],
  );

  useEffect(() => {
    if (initialized || !identities || !profiles || profiles.length === 0) return;
    const sorted = [...identities].sort((a, b) => {
      const profileA = profiles.find((p) => p.actor_id === a.actor_id);
      const profileB = profiles.find((p) => p.actor_id === b.actor_id);
      return (profileB?.risk_score ?? 0) - (profileA?.risk_score ?? 0);
    });
    const topIds = sorted.slice(0, 3).map((a) => a.actor_id);
    setSelectedParticipantIds(new Set(topIds));
    setInitialized(true);
  }, [identities, profiles, initialized]);

  const selectedParticipants = useMemo(
    () =>
      (identities ?? []).filter((a) => selectedParticipantIds.has(a.actor_id)),
    [identities, selectedParticipantIds],
  );

  // With exactly one participant selected there's no thread to show yet —
  // a lone lane full of messages to whoever happened to be flagged reads
  // as talking to nobody. Surfacing who they actually messaged, ranked by
  // volume, turns "select a suspect" into "select a suspect, then pick
  // who to compare them against" in one click instead of a guess.
  const suggestedCounterparts = useMemo(() => {
    if (!artifacts || !actorIndex || selectedParticipants.length !== 1) return [];
    const anchor = selectedParticipants[0];
    const counts = new Map<string, number>();
    for (const a of artifacts) {
      if (a.type !== "message" && a.type !== "call") continue;
      const { from, to } = senderRecipient(a, content ?? {}, actorIndex);
      if (!from || !to || from.actor_id === to.actor_id) continue;
      if (from.actor_id !== anchor.actor_id && to.actor_id !== anchor.actor_id) continue;
      const other = from.actor_id === anchor.actor_id ? to : from;
      counts.set(other.actor_id, (counts.get(other.actor_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([actorId, count]) => ({
        actor: (identities ?? []).find((i) => i.actor_id === actorId),
        count,
      }))
      .filter((x): x is { actor: ResolvedActor; count: number } => !!x.actor);
  }, [artifacts, actorIndex, selectedParticipants, identities, content]);

  const relevantArtifactIds = useMemo(() => {
    if (!profiles || !artifacts) return new Set<string>();
    const ids = new Set<string>();
    for (const p of profiles) {
      if (p.risk_score >= CONCERN_THRESHOLD) {
        for (const evidenceIds of Object.values(p.signal_evidence)) {
          for (const id of evidenceIds) ids.add(id);
        }
      }
    }
    for (const a of artifacts) {
      if (a.flags.length > 0) ids.add(a.artifact_id);
    }
    const ann = annotations;
    for (const [id, a] of Object.entries(ann)) {
      if (a.tags.length > 0) ids.add(id);
    }
    return ids;
  }, [profiles, artifacts, annotations]);

  const filtered = useMemo(() => {
    if (!artifacts) return [];
    return artifacts.filter((a) => {
      if (mediaFilter !== "all" && a.type !== mediaFilter) return false;
      if (relevanceFilter && !relevantArtifactIds.has(a.artifact_id)) {
        const isFromPOI = profiles.some(
          (p) => p.risk_score >= CONCERN_THRESHOLD && a.actors.some((act) => p.identifiers.includes(act)),
        );
        if (!isFromPOI) return false;
      }
      return true;
    });
  }, [artifacts, mediaFilter, relevanceFilter, relevantArtifactIds, profiles]);

  const relevantCount = relevantArtifactIds.size;
  const totalCount = artifacts?.length ?? 0;

  function toggleParticipant(actorId: string) {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(actorId)) next.delete(actorId);
      else next.add(actorId);
      return next;
    });
  }

  async function addTag(artifactId: string, tag: string) {
    const res = await fetch(`/api/cases/${caseId}/artifacts/${artifactId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    const updated = await res.json();
    setAnnotations((prev) => ({ ...prev, [artifactId]: updated }));
  }

  async function removeTag(artifactId: string, tag: string) {
    const res = await fetch(
      `/api/cases/${caseId}/artifacts/${artifactId}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" },
    );
    const updated = await res.json();
    setAnnotations((prev) => ({ ...prev, [artifactId]: updated }));
  }

  async function saveNotes(artifactId: string, text: string) {
    const res = await fetch(`/api/cases/${caseId}/artifacts/${artifactId}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const updated = await res.json();
    setAnnotations((prev) => ({ ...prev, [artifactId]: updated }));
  }

  function selectArtifact(artifactId: string) {
    setSelectedArtifactId(artifactId);
    const el = document.getElementById(`artifact-${artifactId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function jumpToDate(date: string) {
    const el = document.getElementById(`day-${date}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!artifacts || !identities || !content || !actorIndex) {
    return <p className="p-6 text-[13px] text-label-secondary">Loading timeline...</p>;
  }

  const selectedArtifact = selectedArtifactId
    ? (artifactsById.get(selectedArtifactId) ?? null)
    : null;

  return (
    <div className="space-y-3">
      {/* Participant bar */}
      <ParticipantBar
        identities={identities}
        profiles={profiles}
        selectedIds={selectedParticipantIds}
        onToggle={toggleParticipant}
        concernThreshold={CONCERN_THRESHOLD}
      />

      {suggestedCounterparts.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-separator bg-surface/50 px-3 py-2">
          <span className="shrink-0 text-[11px] text-label-tertiary">
            {selectedParticipants[0].label} messaged:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {suggestedCounterparts.map(({ actor, count }) => (
              <button
                key={actor.actor_id}
                onClick={() => toggleParticipant(actor.actor_id)}
                className="flex items-center gap-1.5 rounded-full border border-separator bg-canvas px-2 py-1 text-[11px] text-label-secondary transition-colors hover:border-accent-blue hover:text-accent-blue"
              >
                <Avatar name={actor.label} size={16} />
                {actor.label}
                <span className="text-label-quaternary">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between border-t border-separator pt-3">
        {/* Left: AI Relevance + mode toggle */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setRelevanceFilter((v) => !v)}
            className="flex items-center gap-2 text-[12px]"
          >
            {relevanceFilter ? (
              <ToggleRight className="size-5 text-accent-blue" />
            ) : (
              <ToggleLeft className="size-5 text-label-tertiary" />
            )}
            <span className="font-medium text-label-primary">AI Relevance Filter:</span>
            <span className="text-label-secondary">
              {relevanceFilter
                ? "Showing relevant messages only"
                : `Showing all ${totalCount} messages`}
            </span>
          </button>
          {relevanceFilter && (
            <button
              onClick={() => setRelevanceFilter(false)}
              className="text-[12px] text-accent-blue hover:underline"
            >
              Show all messages
            </button>
          )}
        </div>

        {/* Right: Zoom + Mode */}
        <div className="flex items-center gap-3">
          {/* Media filter */}
          <div className="flex items-center gap-0.5 rounded-lg border border-separator bg-surface p-0.5">
            {MEDIA_FILTERS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setMediaFilter(value)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  mediaFilter === value
                    ? "bg-accent-blue text-white"
                    : "text-label-secondary hover:bg-canvas"
                }`}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1.5 rounded-lg border border-separator bg-surface px-2 py-1">
            <span className="text-[11px] text-label-secondary">Zoom:</span>
            <select
              value={zoom}
              onChange={(e) => setZoom(e.target.value as ZoomLevel)}
              className="bg-transparent text-[11px] font-medium text-label-primary focus:outline-none"
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
              <option value="day">Day</option>
            </select>
          </div>

          <button
            onClick={() => {
              const el = document.querySelector('[id^="day-"]');
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex items-center gap-1 rounded-lg border border-separator px-2 py-1 text-[11px] text-label-secondary hover:bg-surface"
          >
            <Maximize2 className="size-3" />
            Fit to view
          </button>

          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-separator bg-surface p-0.5">
            <button
              onClick={() => setMode("chronological")}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === "chronological"
                  ? "bg-accent-blue text-white"
                  : "text-label-secondary hover:bg-canvas"
              }`}
            >
              Chronological
            </button>
            <button
              onClick={() => setMode("semantic")}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === "semantic"
                  ? "bg-accent-blue text-white"
                  : "text-label-secondary hover:bg-canvas"
              }`}
            >
              Semantic
            </button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex gap-0">
        {/* Timeline */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-separator">
          {mode === "chronological" ? (
            <LaneTimeline
              artifacts={filtered}
              content={content}
              actorIndex={actorIndex}
              selectedParticipants={selectedParticipants}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={selectArtifact}
              zoom={zoom}
              focusArtifactId={focusArtifactId}
            />
          ) : (
            <SemanticTimeline
              caseId={caseId}
              artifacts={filtered}
              content={content}
              actorIndex={actorIndex}
              selectedParticipants={selectedParticipants}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={selectArtifact}
            />
          )}

          {/* Minimap */}
          <TimelineMinimap artifacts={filtered} onJumpToDate={jumpToDate} />

          {/* Legend */}
          <div className="flex items-center gap-4 border-t border-separator px-3 py-2">
            <LegendItem color="var(--accent-blue)" bgOpacity="10" label="Normal" />
            <LegendItem color="var(--accent-red)" bgOpacity="15" label="Flagged" />
            <LegendItem color="var(--accent-amber)" bgOpacity="15" label="Alert fired" />
            <span className="mx-1 h-3 border-l border-separator" />
            <LegendIcon icon="🟢" label="WhatsApp" />
            <LegendIcon icon="📸" label="Instagram" />
            <LegendIcon icon="📞" label="Call" />
            <LegendIcon icon="🌐" label="Browser" />
            <LegendIcon icon="🖼️" label="Image" />
            <LegendIcon icon="🎬" label="Video" />
            <LegendIcon icon="🎵" label="Audio" />
          </div>
        </div>

        {/* Event Detail Panel */}
        <div className="ml-3 w-80 shrink-0">
          <EventDetailPanel
            key={selectedArtifactId ?? "none"}
            artifact={selectedArtifact}
            content={content}
            actorIndex={actorIndex}
            annotation={
              selectedArtifactId ? annotations[selectedArtifactId] : undefined
            }
            linkedArtifacts={
              selectedArtifactId ? (correlations[selectedArtifactId] ?? []) : []
            }
            artifactsById={artifactsById}
            onAddTag={addTag}
            onRemoveTag={removeTag}
            onSaveNotes={saveNotes}
            onSelectArtifact={selectArtifact}
          />
        </div>
      </div>
    </div>
  );
}

function LegendItem({
  color,
  bgOpacity,
  label,
}: {
  color: string;
  bgOpacity: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-label-tertiary">
      <span
        className="inline-block size-3 rounded"
        style={{ backgroundColor: color, opacity: parseInt(bgOpacity) / 100 + 0.3 }}
      />
      {label}
    </span>
  );
}

function LegendIcon({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-label-tertiary">
      <span className="text-[10px]">{icon}</span>
      {label}
    </span>
  );
}

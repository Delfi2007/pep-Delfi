"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import type { Artifact, GroomingStage, ResolvedActor, StageBlock } from "@/lib/types";
import type { ContentMap } from "@/lib/artifactPreview";
import type { ActorIndex } from "@/lib/actorColors";
import { getJson } from "@/lib/fetchJson";
import { Avatar } from "@/components/timeline/ParticipantBar";
import { MessageCard } from "@/components/timeline/MessageCard";
import { formatDayHeader } from "@/lib/timelineGrouping";
import { senderRecipient } from "@/lib/timelineDisplay";

const STAGE_COLORS: Record<string, string> = {
  contact: "#007AFF",
  trust_building: "#34C759",
  isolation: "#FF9500",
  channel_migration: "#AF52DE",
  escalation: "#FF3B30",
  contact_request: "#FF2D55",
};

const STAGE_ORDER: GroomingStage[] = [
  "contact",
  "trust_building",
  "isolation",
  "channel_migration",
  "escalation",
  "contact_request",
];

type Props = {
  caseId: string;
  artifacts: Artifact[];
  content: ContentMap;
  actorIndex: ActorIndex;
  selectedParticipants: ResolvedActor[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
};

function StageProgressBar({ stages }: { stages: StageBlock[] }) {
  const stageSet = new Set(stages.map((s) => s.stage));
  return (
    <div className="flex items-center gap-1">
      {STAGE_ORDER.map((s, i) => {
        const active = stageSet.has(s);
        const meta = stages.find((b) => b.stage === s);
        return (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && (
              <ArrowRight className="size-3 text-label-quaternary" />
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                active ? "text-white" : "text-label-quaternary"
              }`}
              style={{
                backgroundColor: active ? STAGE_COLORS[s] : "var(--separator)",
              }}
              title={meta ? `${meta.message_count} messages, ${meta.duration_days} days` : "Not reached"}
            >
              {s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()).split(" ")[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StageSection({
  block,
  artifacts,
  content,
  actorIndex,
  selectedParticipants,
  selectedArtifactId,
  onSelectArtifact,
  prevStage,
}: {
  block: StageBlock;
  artifacts: Artifact[];
  content: ContentMap;
  actorIndex: ActorIndex;
  selectedParticipants: ResolvedActor[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  prevStage: GroomingStage | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = STAGE_COLORS[block.stage] ?? "#8E8E93";
  const idsSet = new Set(block.artifact_ids);
  const blockArtifacts = artifacts.filter((a) => idsSet.has(a.artifact_id));

  const signalArtifacts = blockArtifacts.filter((a) =>
    block.signal_matches.some((m) => m.artifact_id === a.artifact_id),
  );
  const displayArtifacts = expanded ? blockArtifacts : signalArtifacts.slice(0, 8);

  const stageIdx = STAGE_ORDER.indexOf(block.stage);
  const prevIdx = prevStage ? STAGE_ORDER.indexOf(prevStage) : -1;
  const isEscalation = stageIdx > prevIdx;

  return (
    <div className="border-b border-separator">
      {/* Stage header */}
      <div
        className="flex items-center gap-3 px-3 py-3"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded-md px-2 py-0.5 text-[12px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {block.label}
            </span>
            {isEscalation && prevStage && (
              <ArrowUpRight className="size-3.5 text-accent-red" />
            )}
            <span className="text-[11px] text-label-tertiary">
              {formatDayHeader(block.start_date)} — {formatDayHeader(block.end_date)}
              {" · "}{block.duration_days} day{block.duration_days !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-label-secondary">{block.description}</p>
        </div>
        <div className="text-right text-[11px] text-label-tertiary">
          <div>{block.message_count} messages</div>
          <div>{block.signal_matches.length} signal matches</div>
        </div>
      </div>

      {/* Messages grid */}
      <div className="flex">
        {/* Time label column */}
        <div className="w-24 shrink-0" />

        {/* Participant lanes — one message lives in exactly one lane, the
            author's, never both sides of a pair; otherwise a two-person
            selection would show every message twice. */}
        {selectedParticipants.map((p) => {
          const pMsgs = displayArtifacts.filter((a) => {
            const { from } = senderRecipient(a, content, actorIndex);
            return from?.actor_id === p.actor_id;
          });
          return (
            <div
              key={p.actor_id}
              className="flex min-w-[180px] flex-1 flex-col gap-1 border-l border-separator/30 px-2 py-1.5"
            >
              {pMsgs.map((a) => {
                const { to } = senderRecipient(a, content, actorIndex);
                return (
                  <MessageCard
                    key={a.artifact_id}
                    artifact={a}
                    content={content}
                    selected={a.artifact_id === selectedArtifactId}
                    onSelect={() => onSelectArtifact(a.artifact_id)}
                    counterpart={to && to.actor_id !== p.actor_id ? to.label : null}
                    direction="out"
                  />
                );
              })}
            </div>
          );
        })}

        {/* Summary panel */}
        <div className="w-64 shrink-0 border-l border-separator bg-surface/50 p-3">
          <p className="text-[11px] font-semibold text-label-primary">{block.label}</p>
          <p className="mt-1 text-[11px] text-label-secondary">
            {block.signal_matches.length > 0
              ? `${block.signal_matches.length} of ${block.message_count} messages matched ${block.label.toLowerCase()} signals`
              : `${block.message_count} messages in this stage`}
          </p>
          {block.signal_matches.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-medium text-label-tertiary">KEY PHRASES:</p>
              {block.signal_matches.slice(0, 3).map((m, i) => (
                <p key={i} className="text-[10px] italic text-label-secondary">
                  &ldquo;{m.matched}&rdquo;
                </p>
              ))}
            </div>
          )}
          <div className="mt-2">
            <p className="text-[10px] font-medium text-label-tertiary">CITED:</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {block.artifact_ids.slice(0, 5).map((id) => (
                <button
                  key={id}
                  onClick={() => onSelectArtifact(id)}
                  className="rounded bg-canvas px-1 py-0.5 font-mono text-[9px] text-accent-blue hover:underline"
                >
                  {id}
                </button>
              ))}
              {block.artifact_ids.length > 5 && (
                <span className="text-[9px] text-label-quaternary">
                  +{block.artifact_ids.length - 5}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expand toggle */}
      {blockArtifacts.length > displayArtifacts.length && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-dashed border-separator py-1.5 text-[11px] text-accent-blue hover:bg-surface"
        >
          {expanded ? "Show key messages only" : `Show all ${blockArtifacts.length} messages`}
          <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

export function SemanticTimeline({
  caseId,
  artifacts,
  content,
  actorIndex,
  selectedParticipants,
  selectedArtifactId,
  onSelectArtifact,
}: Props) {
  const [stages, setStages] = useState<StageBlock[]>([]);
  const [loading, setLoading] = useState(false);

  const actor1 = selectedParticipants[0]?.identifiers[0];
  const actor2 = selectedParticipants[1]?.identifiers[0];

  useEffect(() => {
    if (!actor1 || !actor2) {
      setStages([]);
      return;
    }
    setLoading(true);
    getJson<StageBlock[]>(
      `/api/cases/${caseId}/stages?actor1=${encodeURIComponent(actor1)}&actor2=${encodeURIComponent(actor2)}`,
    )
      .then(setStages)
      .catch(() => setStages([]))
      .finally(() => setLoading(false));
  }, [caseId, actor1, actor2]);

  if (selectedParticipants.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-label-tertiary">
        Select at least 2 participants to view semantic analysis
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-label-secondary">
        Analyzing grooming stages...
      </div>
    );
  }

  return (
    <div className="space-y-0 overflow-auto" style={{ maxHeight: "calc(75vh - 60px)" }}>
      {/* Stage progression bar */}
      <div className="sticky top-0 z-10 border-b border-separator bg-canvas/95 px-3 py-2 backdrop-blur">
        <StageProgressBar stages={stages} />
      </div>

      {/* Lane headers */}
      <div className="sticky top-[36px] z-10 flex border-b border-separator bg-canvas/95 backdrop-blur">
        <div className="w-24 shrink-0 px-2 py-2">
          <span className="text-[11px] font-semibold text-label-secondary">STAGE</span>
        </div>
        {selectedParticipants.map((p) => (
          <div
            key={p.actor_id}
            className="flex min-w-[180px] flex-1 items-center gap-2 border-l border-separator px-3 py-2"
          >
            <Avatar name={p.label} size={24} />
            <span className="truncate text-[12px] font-semibold text-label-primary">
              {p.label}
            </span>
          </div>
        ))}
        <div className="w-64 shrink-0 border-l border-separator px-3 py-2">
          <span className="text-[11px] font-semibold text-label-secondary">SUMMARY</span>
        </div>
      </div>

      {/* Stage blocks */}
      {stages.map((block, i) => (
        <StageSection
          key={`${block.stage}-${block.start_date}`}
          block={block}
          artifacts={artifacts}
          content={content}
          actorIndex={actorIndex}
          selectedParticipants={selectedParticipants}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={onSelectArtifact}
          prevStage={i > 0 ? stages[i - 1].stage : null}
        />
      ))}

      {stages.length === 0 && !loading && (
        <div className="flex h-48 items-center justify-center text-[13px] text-label-tertiary">
          No stage data available for this participant pair
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Artifact, ArtifactAnnotation, Correlation } from "@/lib/types";
import type { ActorIndex } from "@/lib/actorColors";
import { previewFor, type ContentMap } from "@/lib/artifactPreview";
import { categoryLabel, senderRecipient } from "@/lib/timelineDisplay";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformForArtifact } from "@/lib/platforms";
import { formatDayHeader, formatTime } from "@/lib/timelineGrouping";

const PRESET_TAGS = [
  "Inappropriate",
  "Minor",
  "Potential Grooming",
  "Isolation Language",
  "Channel Migration",
  "Escalation",
];

export function EventDetailPanel({
  artifact,
  content,
  actorIndex,
  annotation,
  linkedArtifacts,
  artifactsById,
  onAddTag,
  onRemoveTag,
  onSaveNotes,
  onSelectArtifact,
}: {
  artifact: Artifact | null;
  content: ContentMap;
  actorIndex: ActorIndex;
  annotation: ArtifactAnnotation | undefined;
  linkedArtifacts: Correlation[];
  artifactsById: Map<string, Artifact>;
  onAddTag: (artifactId: string, tag: string) => void;
  onRemoveTag: (artifactId: string, tag: string) => void;
  onSaveNotes: (artifactId: string, text: string) => void;
  onSelectArtifact: (artifactId: string) => void;
}) {
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [notesDraft, setNotesDraft] = useState(annotation?.notes ?? "");
  const [customTag, setCustomTag] = useState("");

  if (!artifact) {
    return (
      <div className="flex w-80 shrink-0 items-center justify-center text-center">
        <p className="px-4 text-[13px] text-label-tertiary">
          Select an event to see its details
        </p>
      </div>
    );
  }

  const { from, to } = senderRecipient(artifact, content, actorIndex);
  const tags = annotation?.tags ?? [];

  function submitCustomTag() {
    const tag = customTag.trim();
    if (tag) {
      onAddTag(artifact!.artifact_id, tag);
      setCustomTag("");
    }
  }

  return (
    <div className="w-80 shrink-0 overflow-y-auto pl-1">
      <p className="mb-3 text-[13px] font-semibold text-label-primary">Event Details</p>

      <dl className="space-y-2.5 text-[13px]">
        <Row label="Time" value={formatTime(artifact.time.value) + (artifact.time.tz_inferred ? " (inferred)" : "")} />
        <Row label="Date" value={formatDayHeader(artifact.time.value.slice(0, 10))} />
        <Row label="From" value={from?.label ?? "—"} valueClassName="text-accent-blue" />
        <Row label="To" value={to?.label ?? "—"} valueClassName="text-accent-red" />
        <Row
          label="Platform"
          value={
            <PlatformBadge platform={platformForArtifact(artifact)} size={15} />
          }
        />
        <Row label="Type" value={categoryLabel(artifact)} />
        <Row label="Artifact ID" value={artifact.artifact_id} mono />
        <Row label="Confidence" value={`${Math.round(artifact.time.confidence * 100)}%`} />
        <div className="flex items-center justify-between">
          <dt className="text-label-secondary">Status</dt>
          <dd>
            {artifact.flags.length > 0 ? (
              <span className="rounded-full bg-accent-amber/15 px-2 py-0.5 text-[11px] font-medium text-accent-amber">
                FLAGGED
              </span>
            ) : (
              <span className="text-label-tertiary">Clear</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-separator pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-label-primary">Evidence Tags</p>
          <button
            onClick={() => setShowTagMenu((v) => !v)}
            className="flex items-center gap-1 text-[13px] text-accent-blue"
          >
            <Plus className="size-3.5" />
            Add Tag
          </button>
        </div>

        {showTagMenu && (
          <div className="mb-2 rounded-control border border-separator bg-surface p-2">
            <div className="mb-2 flex flex-wrap gap-1">
              {PRESET_TAGS.filter((t) => !tags.includes(t)).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    onAddTag(artifact.artifact_id, t);
                    setShowTagMenu(false);
                  }}
                  className="rounded-full bg-canvas px-2 py-1 text-[11px] text-label-primary hover:bg-separator"
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCustomTag()}
                placeholder="Custom tag…"
                className="flex-1 rounded-control border border-separator bg-canvas px-2 py-1 text-[12px] text-label-primary placeholder:text-label-tertiary focus:outline-none"
              />
              <button
                onClick={submitCustomTag}
                className="rounded-control bg-accent-blue px-2 py-1 text-[12px] font-medium text-white"
              >
                Add
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <p className="text-[12px] text-label-tertiary">No tags yet</p>}
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-accent-red/15 px-2.5 py-1 text-[11px] font-medium text-accent-red"
            >
              {tag}
              <button onClick={() => onRemoveTag(artifact.artifact_id, tag)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-separator pt-4">
        <p className="mb-2 text-[13px] font-semibold text-label-primary">Notes</p>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => onSaveNotes(artifact.artifact_id, notesDraft)}
          rows={3}
          placeholder="Add investigative notes…"
          className="w-full resize-none rounded-control border border-separator bg-surface px-2.5 py-2 text-[13px] text-label-primary placeholder:text-label-tertiary focus:border-accent-blue focus:outline-none"
        />
      </div>

      {linkedArtifacts.length > 0 && (
        <div className="mt-5 border-t border-separator pt-4">
          <p className="mb-2 text-[13px] font-semibold text-label-primary">
            Linked Artifacts ({linkedArtifacts.length})
          </p>
          <div className="space-y-1.5">
            {linkedArtifacts.map((link) => {
              const linked = artifactsById.get(link.artifact_id);
              if (!linked) return null;
              return (
                <button
                  key={link.artifact_id}
                  onClick={() => onSelectArtifact(link.artifact_id)}
                  className="block w-full truncate rounded-control border border-separator bg-surface px-2.5 py-1.5 text-left text-[12px] text-accent-blue hover:bg-canvas"
                >
                  <span className="font-mono">{link.artifact_id}</span>
                  <span className="ml-2 text-label-secondary">
                    {previewFor(linked, content).slice(0, 40)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  valueClassName,
}: {
  label: string;
  // ReactNode, not string — the Platform row renders a logo alongside its
  // name rather than plain text.
  value: React.ReactNode;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-label-secondary">{label}</dt>
      <dd
        className={`truncate ${mono ? "font-mono" : ""} ${valueClassName ?? "text-label-primary"}`}
      >
        {value}
      </dd>
    </div>
  );
}

"use client";

import { Flag, Image as ImageIcon, Phone, Globe, MessageCircle, Video, Mic, ExternalLink } from "lucide-react";
import type { Artifact } from "@/lib/types";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformForArtifact } from "@/lib/platforms";
import { formatTime } from "@/lib/timelineGrouping";
import type { ContentMap } from "@/lib/artifactPreview";

function typeIcon(artifact: Artifact) {
  switch (artifact.type) {
    case "message": return <MessageCircle className="size-3" />;
    case "call": return <Phone className="size-3" />;
    case "image": return <ImageIcon className="size-3" />;
    case "browser_history": return <Globe className="size-3" />;
  }
}

function mediaTag(artifact: Artifact, content: ContentMap) {
  const c = content[artifact.content_ref];
  if (artifact.type === "image") {
    const filename = typeof c?.filename === "string" ? c.filename : "";
    return (
      <span className="flex items-center gap-1 rounded bg-accent-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue">
        <ImageIcon className="size-2.5" /> {filename || "Image"}
      </span>
    );
  }
  if (artifact.type === "call") {
    const dur = typeof c?.duration_seconds === "number" ? c.duration_seconds : 0;
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    return (
      <span className="flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
        <Phone className="size-2.5" /> {mins}m {secs}s
      </span>
    );
  }
  return null;
}

export function MessageCard({
  artifact,
  content,
  selected,
  onSelect,
  compact = false,
  counterpart = null,
  direction = null,
}: {
  artifact: Artifact;
  content: ContentMap;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
  /** The other party's label, shown so a lane that aggregates several
   * threads (e.g. a suspect's outgoing messages to multiple targets)
   * stays legible — a card alone in a column reveals nothing about who
   * it was sent to. */
  counterpart?: string | null;
  /** "out" = this lane's participant authored it, "in" = they received
   * it from the counterpart. Only meaningful when counterpart is set. */
  direction?: "out" | "in" | null;
}) {
  const c = content[artifact.content_ref];
  const text = typeof c?.text === "string" ? c.text : "";
  const flagged = artifact.flags.length > 0;
  const hasAlert = artifact.flags.some((f) => f.startsWith("hash_match"));
  const platform = platformForArtifact(artifact);

  if (compact) {
    return (
      <button
        onClick={onSelect}
        className={`w-full rounded-md border px-1.5 py-1 text-left transition-colors ${
          flagged
            ? "border-accent-red/30 bg-accent-red/5"
            : hasAlert
              ? "border-accent-amber/30 bg-accent-amber/5"
              : selected
                ? "border-accent-blue bg-accent-blue/5"
                : "border-separator bg-surface hover:border-accent-blue/30"
        }`}
      >
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-label-quaternary">{formatTime(artifact.time.value)}</span>
          <PlatformBadge platform={platform} size={10} showLabel={false} />
          {flagged && <Flag className="size-2 text-accent-red" />}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onSelect}
      id={`artifact-${artifact.artifact_id}`}
      className={`group w-full rounded-xl border px-3 py-2 text-left transition-all ${
        flagged
          ? "border-accent-red/40 bg-accent-red/5 hover:border-accent-red/60"
          : hasAlert
            ? "border-accent-amber/40 bg-accent-amber/5 hover:border-accent-amber/60"
            : selected
              ? "border-accent-blue bg-accent-blue/5 shadow-sm"
              : "border-separator bg-surface hover:border-accent-blue/40 hover:shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          {flagged && <Flag className="size-3 text-accent-red" />}
          <span className="font-mono text-[11px] text-label-tertiary">
            {formatTime(artifact.time.value)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <PlatformBadge platform={platform} size={13} showLabel={false} />
          <ExternalLink className="size-2.5 text-label-quaternary opacity-0 group-hover:opacity-100" />
        </div>
      </div>

      {counterpart && (
        <p className="mt-0.5 text-[10px] font-medium text-label-tertiary">
          {direction === "in" ? "← " : "→ "}
          {counterpart}
        </p>
      )}

      {artifact.type === "message" && text && (
        <p className="mt-1 line-clamp-2 text-[12px] leading-[1.4] text-label-primary">{text}</p>
      )}

      {mediaTag(artifact, content)}
    </button>
  );
}

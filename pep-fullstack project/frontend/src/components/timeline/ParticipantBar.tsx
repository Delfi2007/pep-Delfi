"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, Search } from "lucide-react";
import type { ResolvedActor, SignalProfile } from "@/lib/types";
import { avatarUrl, avatarColor, avatarInitial } from "@/lib/avatars";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";

type Props = {
  identities: ResolvedActor[];
  profiles: SignalProfile[];
  selectedIds: Set<string>;
  onToggle: (actorId: string) => void;
  concernThreshold: number;
};

function concernColor(score: number): string {
  if (score >= 0.75) return "var(--accent-red)";
  if (score >= 0.5) return "#FF9500";
  if (score >= 0.25) return "#FFCC00";
  return "var(--accent-blue)";
}

function ConcernDot({ score }: { score: number }) {
  return (
    <span
      className="inline-block size-2 rounded-full"
      style={{ backgroundColor: concernColor(score) }}
    />
  );
}

function MiniBar({ ratio }: { ratio: number }) {
  const bars = 5;
  return (
    <span className="inline-flex items-end gap-px">
      {Array.from({ length: bars }, (_, i) => {
        const threshold = (i + 1) / bars;
        const active = ratio >= threshold;
        return (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{
              height: 4 + i * 3,
              backgroundColor: active
                ? concernColor(ratio)
                : "var(--label-quaternary)",
            }}
          />
        );
      })}
    </span>
  );
}

function Avatar({
  name,
  size = 36,
}: {
  name: string;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const bg = avatarColor(name);
  const initial = avatarInitial(name);

  if (imgFailed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full text-white font-semibold"
        style={{
          width: size,
          height: size,
          backgroundColor: bg,
          fontSize: size * 0.42,
        }}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={avatarUrl(name, size * 2)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      onError={() => setImgFailed(true)}
    />
  );
}

export { Avatar };

function ParticipantChip({
  actor,
  profile,
  selected,
  onToggle,
}: {
  actor: ResolvedActor;
  profile: SignalProfile | undefined;
  selected: boolean;
  onToggle: () => void;
}) {
  const score = profile?.risk_score ?? 0;
  const totalMsgs = actor.artifact_ids.length;
  const channels = actor.channels ?? [];

  return (
    <button
      onClick={onToggle}
      className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
        selected
          ? "border-accent-blue bg-accent-blue/5"
          : "border-separator bg-surface hover:border-accent-blue/40"
      }`}
      style={{ minWidth: 200 }}
    >
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded border text-[11px] ${
          selected
            ? "border-accent-blue bg-accent-blue text-white"
            : "border-label-quaternary"
        }`}
      >
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      <Avatar name={actor.label} size={36} />

      <div className="min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-label-primary">
            {actor.label}
          </span>
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
            style={{ color: concernColor(score), backgroundColor: `${concernColor(score)}15` }}
          >
            {score.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] text-label-tertiary">
            @{actor.identifiers[0]?.replace(/^\+/, "") ?? actor.label}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-label-tertiary">
          <span>{totalMsgs} msgs</span>
          <MiniBar ratio={score} />
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {channels.slice(0, 3).map((ch) => (
          <PlatformBadge
            key={ch}
            platform={platformFromSource(ch)}
            size={14}
            showLabel={false}
          />
        ))}
        {channels.length > 3 && (
          <span className="text-[10px] text-label-tertiary">+{channels.length - 3}</span>
        )}
      </div>
    </button>
  );
}

export function ParticipantBar({
  identities,
  profiles,
  selectedIds,
  onToggle,
  concernThreshold,
}: Props) {
  const [showOthers, setShowOthers] = useState(false);
  const [search, setSearch] = useState("");

  const profileMap = new Map(profiles.map((p) => [p.actor_id, p]));

  const sorted = [...identities].sort((a, b) => {
    const sa = profileMap.get(a.actor_id)?.risk_score ?? 0;
    const sb = profileMap.get(b.actor_id)?.risk_score ?? 0;
    return sb - sa;
  });

  const relevant = sorted.filter(
    (a) => (profileMap.get(a.actor_id)?.risk_score ?? 0) >= concernThreshold || a.flagged,
  );
  const others = sorted.filter(
    (a) => (profileMap.get(a.actor_id)?.risk_score ?? 0) < concernThreshold && !a.flagged,
  );

  const filteredRelevant = search
    ? relevant.filter((a) =>
        a.label.toLowerCase().includes(search.toLowerCase()) ||
        a.identifiers.some((id) => id.toLowerCase().includes(search.toLowerCase())),
      )
    : relevant;

  const filteredOthers = search
    ? others.filter((a) =>
        a.label.toLowerCase().includes(search.toLowerCase()) ||
        a.identifiers.some((id) => id.toLowerCase().includes(search.toLowerCase())),
      )
    : others;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-label-primary">
            {relevant.length} relevant of {identities.length} participants
          </span>
          <Info className="size-3.5 text-label-tertiary" />
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-label-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participants..."
              className="h-8 w-52 rounded-lg border border-separator bg-surface pl-7 pr-2 text-[12px] text-label-primary placeholder:text-label-quaternary focus:border-accent-blue focus:outline-none"
            />
          </div>
          <select className="h-8 rounded-lg border border-separator bg-surface px-2 text-[12px] text-label-secondary">
            <option>Sort by: Concern score</option>
            <option>Sort by: Message count</option>
            <option>Sort by: Name</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
        {filteredRelevant.map((actor) => (
          <ParticipantChip
            key={actor.actor_id}
            actor={actor}
            profile={profileMap.get(actor.actor_id)}
            selected={selectedIds.has(actor.actor_id)}
            onToggle={() => onToggle(actor.actor_id)}
          />
        ))}
      </div>

      {others.length > 0 && (
        <button
          onClick={() => setShowOthers((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-separator px-3 py-1.5 text-[12px] text-label-tertiary hover:border-accent-blue/40 hover:text-label-secondary"
        >
          {showOthers ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {showOthers ? "Hide" : "Show"} {others.length} other participants
        </button>
      )}

      {showOthers && (
        <div className="flex gap-2 overflow-x-auto pb-2 opacity-60" style={{ scrollbarWidth: "thin" }}>
          {filteredOthers.map((actor) => (
            <ParticipantChip
              key={actor.actor_id}
              actor={actor}
              profile={profileMap.get(actor.actor_id)}
              selected={selectedIds.has(actor.actor_id)}
              onToggle={() => onToggle(actor.actor_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useEffect } from "react";
import type { Artifact, ResolvedActor } from "@/lib/types";
import type { ContentMap } from "@/lib/artifactPreview";
import type { ActorIndex } from "@/lib/actorColors";
import { Avatar } from "@/components/timeline/ParticipantBar";
import { MessageCard } from "@/components/timeline/MessageCard";
import { formatDayHeader } from "@/lib/timelineGrouping";
import { senderRecipient } from "@/lib/timelineDisplay";

export type ZoomLevel = "month" | "week" | "day";

type Props = {
  artifacts: Artifact[];
  content: ContentMap;
  actorIndex: ActorIndex;
  selectedParticipants: ResolvedActor[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  zoom: ZoomLevel;
  focusArtifactId?: string | null;
};

type LaneEntry = { artifact: Artifact; counterpart: string | null };

type DaySlot = {
  date: string;
  hours: Map<number, LaneEntry[]>;
};

/**
 * Groups artifacts into lanes by AUTHOR, not by "any actor present" —
 * a message between the coach and Aisha must appear only in whichever
 * of their lanes actually sent it, never in both, or a lane with no
 * counterparty selected reads as the sender talking to himself.
 *
 * With exactly one participant selected, every message they authored is
 * shown (any counterparty) so there's something to look at before a
 * second person is picked; each card carries a "→ counterparty" label
 * so an aggregated column of several threads stays legible. With two or
 * more selected, a message is included only when *every* actor on it is
 * in the selected set — that's what turns "select 2" into a clean
 * two-party thread and "select suspect + N victims" into N parallel,
 * uncontaminated threads instead of a bag of everyone's messages.
 */
function buildLaneData(
  artifacts: Artifact[],
  content: ContentMap,
  actorIndex: ActorIndex,
  selectedParticipants: ResolvedActor[],
): Map<string, Map<string, DaySlot>> {
  const selectedActorIds = new Set(selectedParticipants.map((p) => p.actor_id));
  const single = selectedParticipants.length === 1;
  const result = new Map<string, Map<string, DaySlot>>();

  for (const a of artifacts) {
    let authorActorId: string | null = null;
    let counterpartLabel: string | null = null;

    if (a.type === "message" || a.type === "call") {
      const { from, to } = senderRecipient(a, content, actorIndex);
      if (!from || !selectedActorIds.has(from.actor_id)) continue;

      if (!single) {
        const resolvedIds = a.actors
          .map((id) => actorIndex.resolve(id)?.actor_id)
          .filter((id): id is string => !!id);
        const allWithinSelection = resolvedIds.every((id) => selectedActorIds.has(id));
        if (!allWithinSelection) continue;
      }

      authorActorId = from.actor_id;
      counterpartLabel = to && to.actor_id !== from.actor_id ? to.label : null;
    } else {
      // image / browser_history — single-owner artifacts, no sender/recipient.
      const owner = a.actors[0] ? actorIndex.resolve(a.actors[0]) : null;
      if (!owner || !selectedActorIds.has(owner.actor_id)) continue;
      authorActorId = owner.actor_id;
    }

    const date = a.time.value.slice(0, 10);
    const hour = parseInt(a.time.value.slice(11, 13), 10);

    if (!result.has(date)) result.set(date, new Map());
    const dayMap = result.get(date)!;
    if (!dayMap.has(authorActorId)) dayMap.set(authorActorId, { date, hours: new Map() });
    const slot = dayMap.get(authorActorId)!;
    if (!slot.hours.has(hour)) slot.hours.set(hour, []);
    slot.hours.get(hour)!.push({ artifact: a, counterpart: counterpartLabel });
  }
  return result;
}

function getHourRange(dayData: Map<string, DaySlot>): [number, number] {
  let minH = 23;
  let maxH = 0;
  for (const slot of dayData.values()) {
    for (const h of slot.hours.keys()) {
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  return [Math.max(0, minH - 1), Math.min(23, maxH + 1)];
}

function HourLabel({ hour }: { hour: number }) {
  const label = `${hour.toString().padStart(2, "0")}:00`;
  return (
    <span className="text-[10px] text-label-quaternary font-mono">{label}</span>
  );
}

export function LaneTimeline({
  artifacts,
  content,
  actorIndex,
  selectedParticipants,
  selectedArtifactId,
  onSelectArtifact,
  zoom,
  focusArtifactId,
}: Props) {
  const laneData = useMemo(
    () => buildLaneData(artifacts, content, actorIndex, selectedParticipants),
    [artifacts, content, actorIndex, selectedParticipants],
  );

  const dayGroups = useMemo(
    () => Array.from(laneData.entries()).sort(([a], [b]) => a.localeCompare(b)),
    [laneData],
  );

  useEffect(() => {
    if (!focusArtifactId) return;
    const el = document.getElementById(`artifact-${focusArtifactId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusArtifactId, dayGroups]);

  const slotHeight = zoom === "day" ? 70 : zoom === "week" ? 48 : 24;
  const cardStyle = zoom === "month" ? "compact" : "normal";

  if (selectedParticipants.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center text-[13px] text-label-tertiary">
        Select participants above to view their timeline
      </div>
    );
  }

  return (
    <div className="overflow-auto" style={{ maxHeight: "calc(75vh - 60px)" }}>
      <div className="inline-flex min-w-full flex-col">
        {/* Lane headers */}
        <div className="sticky top-0 z-20 flex border-b border-separator bg-canvas/95 backdrop-blur">
          <div className="flex w-24 shrink-0 items-center px-2 py-2">
            <span className="text-[11px] font-semibold text-label-secondary">
              TIME ({zoom === "day" ? "Day" : zoom === "week" ? "Week" : "Month"})
            </span>
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
        </div>

        {/* Day sections */}
        {dayGroups.map(([date, dayData]) => {
          const [minH, maxH] = getHourRange(dayData);
          const hours =
            zoom === "day"
              ? Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i)
              : zoom === "week"
                ? [minH, Math.floor((minH + maxH) / 2), maxH]
                : [Math.floor((minH + maxH) / 2)];

          return (
            <div key={date} id={`day-${date}`}>
              {/* Day header */}
              <div className="sticky top-[42px] z-10 flex items-center gap-2 border-b border-separator bg-canvas/90 px-2 py-1.5 backdrop-blur">
                <span className="size-2 rounded-full bg-accent-blue" />
                <span className="text-[12px] font-semibold text-label-primary">
                  {formatDayHeader(date)}
                </span>
              </div>

              {/* Hour rows */}
              {hours.map((hour) => (
                <div
                  key={`${date}-${hour}`}
                  className="flex border-b border-separator/30"
                  style={{ minHeight: slotHeight }}
                >
                  {/* Time axis */}
                  <div className="flex w-24 shrink-0 items-start justify-end px-2 pt-1">
                    <HourLabel hour={hour} />
                  </div>

                  {/* Participant columns */}
                  {selectedParticipants.map((p) => {
                    const slot = dayData.get(p.actor_id);
                    const entries: LaneEntry[] = [];

                    if (slot) {
                      if (zoom === "day") {
                        const hourEntries = slot.hours.get(hour);
                        if (hourEntries) entries.push(...hourEntries);
                      } else {
                        const rangeStart = zoom === "week" ? hour : minH;
                        const rangeEnd =
                          zoom === "week"
                            ? hours.indexOf(hour) < hours.length - 1
                              ? hours[hours.indexOf(hour) + 1]
                              : maxH + 1
                            : maxH + 1;
                        for (const [h, hEntries] of slot.hours) {
                          if (h >= rangeStart && h < rangeEnd) entries.push(...hEntries);
                        }
                      }
                    }

                    const sorted = entries.sort((x, y) =>
                      x.artifact.time.value.localeCompare(y.artifact.time.value),
                    );

                    return (
                      <div
                        key={p.actor_id}
                        className="flex min-w-[180px] flex-1 flex-col gap-1 border-l border-separator/30 px-2 py-1"
                      >
                        {sorted.map(({ artifact: a, counterpart }) => (
                          <MessageCard
                            key={a.artifact_id}
                            artifact={a}
                            content={content}
                            selected={a.artifact_id === selectedArtifactId}
                            onSelect={() => onSelectArtifact(a.artifact_id)}
                            compact={cardStyle === "compact"}
                            counterpart={counterpart}
                            direction="out"
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}

        {dayGroups.length === 0 && (
          <div className="flex h-48 items-center justify-center text-[13px] text-label-tertiary">
            {selectedParticipants.length >= 2
              ? "No messages exchanged directly between the selected participants."
              : "No messages match the current filters."}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import type { Artifact } from "@/lib/types";

type Props = {
  artifacts: Artifact[];
  onJumpToDate: (date: string) => void;
};

export function TimelineMinimap({ artifacts, onJumpToDate }: Props) {
  const { days, maxCount } = useMemo(() => {
    const map = new Map<string, { count: number; flagged: boolean }>();
    for (const a of artifacts) {
      const d = a.time.value.slice(0, 10);
      const entry = map.get(d) ?? { count: 0, flagged: false };
      entry.count++;
      if (a.flags.length > 0) entry.flagged = true;
      map.set(d, entry);
    }
    const days = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, info]) => ({ date, ...info }));
    const maxCount = Math.max(1, ...days.map((d) => d.count));
    return { days, maxCount };
  }, [artifacts]);

  if (days.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-t border-separator px-2 pt-2">
      <span className="shrink-0 text-[10px] text-label-quaternary">
        {days[0]?.date.slice(5)}
      </span>
      <div className="flex flex-1 items-end gap-px" style={{ height: 24 }}>
        {days.map((d) => {
          const h = Math.max(2, (d.count / maxCount) * 24);
          return (
            <button
              key={d.date}
              onClick={() => onJumpToDate(d.date)}
              className="flex-1 rounded-sm transition-colors hover:opacity-80"
              style={{
                height: h,
                minWidth: 2,
                backgroundColor: d.flagged
                  ? "var(--accent-red)"
                  : `color-mix(in srgb, var(--accent-blue) ${Math.round(30 + (d.count / maxCount) * 70)}%, transparent)`,
              }}
              title={`${d.date}: ${d.count} events`}
            />
          );
        })}
      </div>
      <span className="shrink-0 text-[10px] text-label-quaternary">
        {days[days.length - 1]?.date.slice(5)}
      </span>
    </div>
  );
}

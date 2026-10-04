"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Phone,
} from "lucide-react";

type TypeBlock = {
  type: string;
  label: string;
  count: number;
  pct: number;
  flagged: number;
  color: string;
};

type TimelineEntry = {
  date: string;
  message?: number;
  image?: number;
  call?: number;
  browser_history?: number;
  flagged?: number;
};

const TYPE_ICON_MAP: Record<string, typeof MessageCircle> = {
  message: MessageCircle,
  image: ImageIcon,
  call: Phone,
  browser_history: Globe,
  document: FileText,
  other: Folder,
};

function buildSparklinePath(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0) return "";
  const max = Math.max(1, ...values);
  const step = width / Math.max(1, values.length - 1);

  let d = `M 0 ${height}`;
  for (let i = 0; i < values.length; i++) {
    const x = i * step;
    const y = height - (values[i] / max) * height * 0.85;
    if (i === 0) {
      d += ` L ${x} ${y}`;
    } else {
      const prevX = (i - 1) * step;
      const prevY =
        height - (values[i - 1] / max) * height * 0.85;
      const cpx1 = prevX + step * 0.4;
      const cpx2 = x - step * 0.4;
      d += ` C ${cpx1} ${prevY} ${cpx2} ${y} ${x} ${y}`;
    }
  }
  d += ` L ${width} ${height} Z`;
  return d;
}

export function EvidenceMap({
  blocks,
  total,
  timeline,
}: {
  blocks: TypeBlock[];
  total: number;
  timeline?: TimelineEntry[];
}) {
  const [showPct, setShowPct] = useState(false);

  const sorted = [...blocks].sort((a, b) => b.count - a.count);

  const sparkData = useMemo(() => {
    if (!timeline || timeline.length === 0) return null;
    const result: Record<string, number[]> = {};
    for (const block of sorted) {
      result[block.type] = timeline.map(
        (t) => (t as Record<string, number>)[block.type] ?? 0,
      );
    }
    return result;
  }, [timeline, sorted]);

  return (
    <section className="rounded-card border border-separator bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-label-primary">
          Evidence map
          <span className="text-[13px] font-normal text-label-tertiary">
            ({total} artifacts)
          </span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-label-tertiary">
            Group by: Type
          </span>
        </div>
      </div>

      {/* Treemap blocks */}
      <div className="mt-3 flex gap-1.5" style={{ height: 130 }}>
        {sorted.map((block) => {
          const widthPct = total > 0 ? (block.count / total) * 100 : 0;
          if (widthPct < 2) return null;
          const flagIntensity =
            block.flagged > 0
              ? Math.min(0.3 + (block.flagged / block.count) * 0.7, 1)
              : 0;
          const Icon = TYPE_ICON_MAP[block.type] ?? Folder;
          const isNarrow = widthPct < 12;

          return (
            <div
              key={block.type}
              className="relative flex flex-col overflow-hidden rounded-lg"
              style={{
                width: `${widthPct}%`,
                minWidth: 55,
                backgroundColor: block.color,
                opacity: 0.85 + flagIntensity * 0.15,
              }}
            >
              {/* Top: label */}
              <div className="px-2.5 pt-2">
                <span className="text-[11px] font-medium leading-tight text-white/90">
                  {block.label}
                </span>
              </div>
              {/* Middle: count + pct */}
              <div className="flex-1 px-2.5 pt-1">
                <p
                  className={`font-bold leading-none text-white ${isNarrow ? "text-[16px]" : "text-[22px]"}`}
                >
                  {block.count}
                </p>
                <p className="mt-0.5 text-[10px] leading-none text-white/70">
                  {block.pct}%
                </p>
              </div>
              {/* Bottom: icon */}
              <div className="px-2.5 pb-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-white/20">
                  <Icon className="size-3.5 text-white/80" />
                </div>
              </div>
              {/* Flagged dot */}
              {block.flagged > 0 && (
                <div
                  className="absolute right-2 top-2 size-2.5 rounded-full"
                  style={{ backgroundColor: "#FF3B30" }}
                  title={`${block.flagged} flagged`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Wave sparklines below treemap */}
      {sparkData && (
        <div className="-mt-px flex gap-1.5" style={{ height: 36 }}>
          {sorted.map((block) => {
            const widthPct = total > 0 ? (block.count / total) * 100 : 0;
            if (widthPct < 2) return null;
            const values = sparkData[block.type];
            if (!values) return null;

            return (
              <div
                key={block.type}
                className="overflow-hidden rounded-b-lg"
                style={{
                  width: `${widthPct}%`,
                  minWidth: 55,
                  backgroundColor: `${block.color}12`,
                }}
              >
                <svg
                  viewBox="0 0 100 36"
                  preserveAspectRatio="none"
                  className="h-full w-full"
                >
                  <path
                    d={buildSparklinePath(values, 100, 36)}
                    fill={block.color}
                    opacity={0.25}
                  />
                  <path
                    d={buildSparklinePath(values, 100, 36)
                      .replace(/ L 100 36 Z/, "")
                      .replace(/^M 0 36 L /, "M ")}
                    fill="none"
                    stroke={block.color}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-label-tertiary">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-accent-red" />
          Flagged
          <span className="ml-2 text-label-quaternary">
            The brighter the color, the higher the volume
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPct}
            onChange={(e) => setShowPct(e.target.checked)}
            className="size-3"
          />
          Show percentages
        </label>
      </div>
    </section>
  );
}

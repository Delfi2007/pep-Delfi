"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Database,
  FileText,
  FolderClosed,
  ScrollText,
  Sparkles,
  Tag,
  UserCheck,
} from "lucide-react";
import type { AuditEvent, AuditResponse } from "@/lib/types";
import { getJson } from "@/lib/fetchJson";

/**
 * Audit log — what happened to this case, in order, append-only.
 *
 * This is the view the rest of the console has been deferring to. The
 * dashboard has no trend deltas, Alerts has no "new since you last
 * looked", and the report can't say when a lead was confirmed — all
 * three were left absent rather than estimated, because nothing recorded
 * history. This is that record.
 *
 * Two limits are stated on the panel rather than left to be discovered:
 * entries can't say *who* (no user model — attribution is the officer the
 * case names, which is free text), and the log is in memory, so it covers
 * the current session only. Both are printed above the list, because an
 * audit log that overstates what it proves is worse than none.
 *
 * Reads aren't logged. Opening a report is a read; exporting one is an
 * event, because that's the moment case material leaves the console.
 */

const CATEGORY_ICON: Record<string, typeof ScrollText> = {
  case: FolderClosed,
  evidence: Database,
  triage: Sparkles,
  review: UserCheck,
  annotation: Tag,
  alert: Bell,
  report: FileText,
  other: ScrollText,
};

const CATEGORY_LABEL: Record<string, string> = {
  case: "Case",
  evidence: "Evidence",
  triage: "Triage",
  review: "Review",
  annotation: "Annotations",
  alert: "Alerts",
  report: "Reports",
  other: "Other",
};

function formatWhen(value: string): string {
  return value.replace("T", " ").replace("+00:00", " UTC").replace("Z", " UTC");
}

export function AuditView({
  caseId,
  onSelectArtifact,
}: {
  caseId: string;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (selected: string | null) =>
      getJson<AuditResponse>(
        `/api/cases/${caseId}/audit${selected ? `?category=${encodeURIComponent(selected)}` : ""}`,
      ),
    [caseId],
  );

  useEffect(() => {
    load(category)
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof Error
            ? `Failed to load the audit log — ${err.message}`
            : "Failed to load the audit log",
        ),
      );
  }, [load, category]);

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!data) {
    return <p className="p-6 text-[13px] text-label-secondary">Loading audit log…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-label-primary">
          Audit log
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-label-secondary">
          <span className="inline-flex items-center gap-1">
            <ScrollText className="size-3.5 text-label-tertiary" />
            Append-only — no endpoint edits or deletes an entry
          </span>
          <span className="text-label-tertiary">
            {data.total} {data.total === 1 ? "entry" : "entries"} this session
          </span>
        </p>
        <p className="mt-1 text-[13px] text-label-tertiary">
          State changes only: evidence ingested, triage run, a lead ruled on, a tag or
          note saved, an alert acknowledged, a report exported. Opening a view is a read
          and isn&rsquo;t logged. Entries attribute to the officer the case names — this
          build has no sign-in, so the log cannot say who actually clicked, and it lives
          in memory, so it covers this session only.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${
            category === null
              ? "bg-accent-blue text-white"
              : "bg-canvas text-label-secondary hover:text-label-primary"
          }`}
        >
          All {data.total}
        </button>
        {data.categories.map((name) => {
          const Icon = CATEGORY_ICON[name] ?? ScrollText;
          const active = category === name;
          return (
            <button
              key={name}
              onClick={() => setCategory(active ? null : name)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-accent-blue text-white"
                  : "bg-canvas text-label-secondary hover:text-label-primary"
              }`}
            >
              <Icon className="size-3.5" />
              {CATEGORY_LABEL[name] ?? name}
              <span className={active ? "text-white/70" : "text-label-tertiary"}>
                {data.counts[name]}
              </span>
            </button>
          );
        })}
      </div>

      {data.events.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-label-tertiary">
          Nothing has been recorded for this case in this session.
        </p>
      ) : (
        <ol className="flex flex-col">
          {data.events.map((event, index) => (
            <EventRow
              key={event.seq}
              event={event}
              last={index === data.events.length - 1}
              onSelectArtifact={onSelectArtifact}
            />
          ))}
        </ol>
      )}

      {data.truncated && (
        <p className="text-[13px] text-label-tertiary">
          Showing the {data.shown} most recent of {data.total} entries.
        </p>
      )}
    </div>
  );
}

function EventRow({
  event,
  last,
  onSelectArtifact,
}: {
  event: AuditEvent;
  last: boolean;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const Icon = CATEGORY_ICON[event.category] ?? ScrollText;
  // Only the first few IDs: a lead decision can carry six citations, and
  // a log row is a pointer to what happened, not a re-listing of the
  // evidence behind it.
  const shown = event.artifact_ids.slice(0, 4);
  const remaining = event.artifact_ids.length - shown.length;

  return (
    <li className="relative flex gap-3 pl-1">
      {/* Same spine idiom as the timeline — one visual language for
          "things that happened, in order". */}
      <div className="relative flex flex-col items-center">
        <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas">
          <Icon className="size-3.5 text-label-secondary" />
        </span>
        {!last && <span className="w-px flex-1 bg-separator" />}
      </div>

      <div className="min-w-0 flex-1 pb-4 pt-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-label-tertiary">
            {formatWhen(event.at)}
          </span>
          <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] text-label-tertiary">
            {event.action}
          </span>
          <span className="font-mono text-[11px] text-label-tertiary">#{event.seq}</span>
        </div>

        <p className="mt-1 text-[13px] text-label-primary">{event.summary}</p>

        <p className="mt-0.5 text-[11px] text-label-tertiary">
          {event.actor === "unattributed" ? "Unattributed" : event.actor}
        </p>

        {shown.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {shown.map((id) => (
              <button
                key={id}
                onClick={() => onSelectArtifact?.(id)}
                disabled={!onSelectArtifact}
                className="rounded-control bg-canvas px-2 py-1 font-mono text-[11px] text-accent-blue transition-colors hover:bg-accent-blue/10 disabled:pointer-events-none disabled:text-label-secondary"
              >
                {id}
              </button>
            ))}
            {remaining > 0 && (
              <span className="text-[11px] text-label-tertiary">+{remaining} more</span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, FileText, Info } from "lucide-react";
import type { CaseReport, LeadPriority, ReportFinding } from "@/lib/types";
import { getJson } from "@/lib/fetchJson";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformFromSource } from "@/lib/platforms";

/**
 * The case report — `backend/report.py` rendered in the console idiom,
 * with the same document available as Markdown to copy or download.
 *
 * What makes this defensible rather than decorative:
 *
 * - **Only confirmed leads are findings.** A lead the officer rejected is
 *   excluded and counted; a lead nobody has ruled on is reported as
 *   outstanding, never quietly promoted. Section 5 states the review
 *   position, so the document is honest about how much human review it
 *   actually rests on.
 * - **Opening it never runs the agent.** The backend reads the cached
 *   triage result; if triage hasn't been run the report says so instead
 *   of starting a model run whose findings nobody has seen.
 * - **The limitations are data, not UI copy.** `report.method` comes from
 *   the backend and is rendered verbatim both here and in the Markdown,
 *   so the screen and the exported file can't state different caveats.
 * - **Nothing is computed in this component.** Every figure is counted
 *   backend-side from the artifact store; this file only lays it out.
 */

const PRIORITY_TEXT: Record<LeadPriority, string> = {
  high: "text-accent-red",
  medium: "text-accent-amber",
  low: "text-label-tertiary",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").replace("+00:00", " UTC").replace("Z", " UTC");
}

export function ReportView({
  caseId,
  onSelectArtifact,
}: {
  caseId: string;
  /** Evidence IDs in the report open on the Timeline, same as the Triage
   * citations and the search results. */
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const [report, setReport] = useState<CaseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getJson<CaseReport>(`/api/cases/${caseId}/report`)
      .then(setReport)
      .catch((err) =>
        setError(
          err instanceof Error
            ? `Failed to build the report — ${err.message}`
            : "Failed to build the report",
        ),
      );
  }, [caseId]);

  /** Exporting is the moment case material leaves the console, so it's an
   * audit event — unlike opening the report, which is a read. Fire and
   * forget: a failed log write must never block the officer's export. */
  function recordExport(format: string) {
    fetch(`/api/cases/${caseId}/report/exported?format=${format}`, {
      method: "POST",
    }).catch(() => {});
  }

  async function copyMarkdown() {
    if (!report) return;
    await navigator.clipboard.writeText(report.markdown);
    recordExport("markdown-copy");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadMarkdown() {
    if (!report) return;
    // Built and revoked in the browser — the report never leaves the
    // machine, which for case material is the only acceptable answer.
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const slug = (report.case.fir_number ?? report.case.case_id).replace(
      /[^a-zA-Z0-9]+/g,
      "-",
    );
    link.download = `acpia-report-${slug}.md`;
    link.click();
    URL.revokeObjectURL(url);
    recordExport("markdown-download");
  }

  if (error) return <p className="p-6 text-[13px] text-accent-red">{error}</p>;
  if (!report) {
    return <p className="p-6 text-[13px] text-label-secondary">Building report…</p>;
  }

  const { evidence, identities, persons_of_interest, findings, annotations } = report;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-label-primary">
            Case report
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-label-secondary">
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5 text-label-tertiary" />
              Generated {formatTimestamp(report.generated_at)}
            </span>
            <span className="text-label-tertiary">
              Assembled from ingested evidence and the officer&rsquo;s own rulings —
              nothing here is estimated
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={copyMarkdown}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/10"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy Markdown"}
          </button>
          <button
            onClick={downloadMarkdown}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/10"
          >
            <Download className="size-3.5" />
            Download .md
          </button>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-separator p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="FIR number" value={report.case.fir_number ?? "—"} mono />
        <Field label="Station" value={report.case.station ?? "—"} />
        <Field
          label="Investigating officer"
          value={report.case.investigating_officer ?? "—"}
        />
        <Field label="Case status" value={report.case.status.replace("_", " ")} />
        <Field label="Case ID" value={report.case.case_id} mono />
      </dl>

      <Section number={1} title="Evidence summary">
        <p className="text-[15px] text-label-primary">
          <span className="font-semibold">{evidence.total}</span> artifacts parsed
          {evidence.flagged > 0 && (
            <span className="font-medium text-accent-amber">
              {" "}
              · {evidence.flagged} flagged
            </span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {evidence.by_type.map((row) => (
            <span
              key={row.type}
              className="rounded-full bg-canvas px-2.5 py-1 text-[11px] text-label-secondary"
            >
              <span className="font-semibold text-label-primary">{row.count}</span>{" "}
              {row.label}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {evidence.sources.map((row) => (
            <span
              key={row.source}
              className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] text-label-secondary"
            >
              <PlatformBadge platform={platformFromSource(row.source)} size={12} />
              <span className="text-label-tertiary">{row.count}</span>
            </span>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-label-secondary">
          <span className="text-label-tertiary">Period covered — </span>
          {formatTimestamp(evidence.first_event)} to {formatTimestamp(evidence.last_event)}
        </p>

        {evidence.flagged_artifacts.length > 0 && (
          <div className="mt-4 border-t border-separator pt-3">
            <p className="text-[11px] text-label-tertiary">Flagged artifacts</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {evidence.flagged_artifacts.map((item) => (
                <li
                  key={item.artifact_id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]"
                >
                  <EvidenceChip id={item.artifact_id} onSelect={onSelectArtifact} />
                  <span className="text-label-secondary">{item.source}</span>
                  <span className="rounded-full bg-accent-amber/15 px-2 py-0.5 text-[11px] font-medium text-accent-amber">
                    {item.flags.join(", ")}
                  </span>
                  <span className="font-mono text-[11px] text-label-tertiary">
                    {formatTimestamp(item.time)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section number={2} title="Identity resolution">
        <p className="text-[13px] text-label-secondary">
          <span className="font-semibold text-label-primary">
            {identities.resolved_actors}
          </span>{" "}
          distinct actors resolved from the identifiers appearing across the evidence.
        </p>
        {identities.cross_channel.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-separator">
            {identities.cross_channel.map((actor) => (
              <li key={actor.label} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="text-[13px] font-medium text-label-primary">
                  {actor.label}
                </span>
                {actor.identifiers.map((identifier) => (
                  <span
                    key={identifier}
                    className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] text-label-secondary"
                  >
                    {identifier}
                  </span>
                ))}
                <span className="flex flex-wrap items-center gap-2">
                  {actor.channels.map((channel) => (
                    <PlatformBadge
                      key={channel}
                      platform={platformFromSource(channel)}
                      size={12}
                    />
                  ))}
                </span>
                <span className="ml-auto text-[11px] text-label-tertiary">
                  {actor.artifact_count} artifacts
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section number={3} title="Persons of interest">
        {persons_of_interest.length === 0 ? (
          <p className="text-[13px] text-label-tertiary">
            No actor reaches the concern threshold on the deterministic signal scoring.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {persons_of_interest.map((person) => (
              <li key={person.label}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-[15px] font-semibold text-label-primary">
                    {person.label}
                  </h4>
                  <span className="font-mono text-[13px] text-label-secondary">
                    risk {person.risk_score.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-label-secondary">
                  {person.messages_authored} messages authored across{" "}
                  {person.counterparties.length} contacts and{" "}
                  {person.channels.length} channels ·{" "}
                  {Math.round(person.late_night_ratio * 100)}% late-night · escalation
                  slope {person.escalation_slope.toFixed(2)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {Object.entries(person.signal_counts).map(([signal, count]) => (
                    <span
                      key={signal}
                      className="rounded-full bg-canvas px-2.5 py-1 text-[11px] text-label-secondary"
                    >
                      <span className="font-semibold text-label-primary">{count}</span>{" "}
                      {signal.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                {person.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {person.evidence.map((id) => (
                      <EvidenceChip key={id} id={id} onSelect={onSelectArtifact} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section number={4} title="Findings">
        {!findings.triage_run ? (
          <Note>
            Triage has not been run for this case, so there are no reviewed leads to
            report. Open the Triage tab and rule on the leads to populate this section.
          </Note>
        ) : findings.confirmed.length === 0 && findings.flagged_for_review.length === 0 ? (
          <Note>
            No lead has been confirmed by the investigating officer. This report
            therefore contains the evidence summary above but states no findings.
          </Note>
        ) : (
          <>
            <p className="text-[13px] text-label-tertiary">
              Only leads an investigating officer has confirmed appear as findings.
              Rejected leads are excluded and counted below.
            </p>
            <ol className="mt-3 flex flex-col gap-4">
              {findings.confirmed.map((finding, i) => (
                <FindingBlock
                  key={finding.title}
                  index={i + 1}
                  finding={finding}
                  onSelectArtifact={onSelectArtifact}
                />
              ))}
            </ol>
            {findings.flagged_for_review.length > 0 && (
              <div className="mt-4 border-t border-separator pt-3">
                <p className="text-[11px] text-label-tertiary">
                  Flagged for further review
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {findings.flagged_for_review.map((lead) => (
                    <li
                      key={lead.title}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-label-primary"
                    >
                      {lead.title}
                      {lead.evidence.map((id) => (
                        <EvidenceChip key={id} id={id} onSelect={onSelectArtifact} />
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      <Section number={5} title="Review position">
        {findings.triage_run ? (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Confirmed" value={String(findings.confirmed.length)} mono />
              <Field
                label="Flagged for review"
                value={String(findings.flagged_for_review.length)}
                mono
              />
              <Field label="Rejected" value={String(findings.rejected_count)} mono />
              <Field
                label="Not yet ruled on"
                value={String(findings.undecided_count)}
                mono
              />
            </div>
            <p className="mt-3 text-[13px] text-label-tertiary">
              Leads produced by{" "}
              {findings.source === "agent"
                ? `agentic triage (${findings.model})`
                : "deterministic rule-based triage"}
              .
            </p>
          </>
        ) : (
          <p className="text-[13px] text-label-tertiary">
            Triage not run for this case.
          </p>
        )}

        {annotations.count > 0 && (
          <div className="mt-4 border-t border-separator pt-3">
            <p className="text-[11px] text-label-tertiary">Investigator annotations</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {annotations.items.map((item) => (
                <li
                  key={item.artifact_id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-label-secondary"
                >
                  <EvidenceChip id={item.artifact_id} onSelect={onSelectArtifact} />
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-canvas px-2 py-0.5 text-[11px] text-label-secondary"
                    >
                      {tag}
                    </span>
                  ))}
                  {item.notes.trim() && <span>{item.notes.trim()}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section number={6} title="Method and limitations">
        <ul className="flex flex-col gap-2">
          {report.method.map((note) => (
            <li key={note} className="flex gap-2 text-[13px] text-label-secondary">
              <Info className="mt-0.5 size-3.5 shrink-0 text-label-tertiary" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="mb-3 text-[11px] font-medium tracking-wide text-label-tertiary">
        {number}. {title.toUpperCase()}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-label-tertiary">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-[15px] capitalize text-label-primary ${
          mono ? "font-mono text-[13px] normal-case" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border border-dashed border-separator px-4 py-3 text-[13px] text-label-secondary">
      {children}
    </p>
  );
}

function EvidenceChip({
  id,
  onSelect,
}: {
  id: string;
  onSelect?: (artifactId: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect?.(id)}
      disabled={!onSelect}
      className="rounded-control bg-canvas px-2 py-1 font-mono text-[11px] text-accent-blue transition-colors hover:bg-accent-blue/10 disabled:pointer-events-none disabled:text-label-secondary"
    >
      {id}
    </button>
  );
}

function FindingBlock({
  index,
  finding,
  onSelectArtifact,
}: {
  index: number;
  finding: ReportFinding;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  return (
    <li className="rounded-card border border-separator p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-semibold text-label-primary">
          Finding {index}: {finding.title}
        </h4>
        <span className={`text-[11px] font-medium ${PRIORITY_TEXT[finding.priority]}`}>
          {finding.priority} priority
        </span>
      </div>
      {finding.actors.length > 0 && (
        <p className="mt-1 text-[13px] text-label-tertiary">
          {finding.actors.join(", ")}
        </p>
      )}
      <p className="mt-2 text-[15px] leading-relaxed text-label-primary">
        {finding.summary}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-label-tertiary">Evidence</span>
        {finding.evidence.map((id) => (
          <EvidenceChip key={id} id={id} onSelect={onSelectArtifact} />
        ))}
      </div>
      <p className="mt-3 text-[13px] text-label-secondary">
        <span className="text-label-tertiary">Recommended action — </span>
        {finding.recommended_action}
      </p>
      {finding.note && (
        <p className="mt-2 text-[13px] text-label-secondary">
          <span className="text-label-tertiary">Officer&rsquo;s note — </span>
          {finding.note}
        </p>
      )}
    </li>
  );
}

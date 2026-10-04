"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Info,
  Loader2,
  MessageCircle,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ScoreBar } from "@/components/ml/MlCharts";
import { getJson } from "@/lib/fetchJson";
import {
  SIGNAL_LABELS,
  fmt,
  pct,
  type MlCaseAnalysis,
  type MlCompare,
  type MlModelSummary,
  type MlThread,
  type SignalHits,
} from "@/lib/mlTypes";

/**
 * ML analysis — the trained PAN12 models run over this case's own threads.
 *
 * It sits beside AI triage, not on top of it: triage reasons with the
 * deterministic signal layer and an agent; this view shows what supervised
 * classifiers trained on the PAN 2012 benchmark make of the same messages.
 * Neither decides anything. Scores here are proposals for an officer, and
 * the view says plainly where they are unreliable.
 */
export function MLAnalysisView({
  caseId,
  onSelectArtifact,
}: {
  caseId: string;
  onSelectArtifact?: (artifactId: string) => void;
}) {
  const [models, setModels] = useState<MlModelSummary[]>([]);
  const [model, setModel] = useState("char_lr");
  const [analysis, setAnalysis] = useState<MlCaseAnalysis | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<MlCompare | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    getJson<MlModelSummary[]>("/api/ml/models")
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    getJson<MlCaseAnalysis>(`/api/cases/${caseId}/ml?model=${model}`, { signal: controller.signal })
      .then((data) => {
        setAnalysis(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "ML analysis failed");
        setStatus("error");
      });
    return () => controller.abort();
  }, [caseId, model]);

  async function runCompare() {
    setComparing(true);
    try {
      setCompare(await getJson<MlCompare>(`/api/cases/${caseId}/ml/compare`));
    } catch {
      setCompare(null);
    } finally {
      setComparing(false);
    }
  }

  const live = models.filter((m) => m.live);
  const summary = models.find((m) => m.id === model);

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-accent-red">{error}</p>
        <p className="max-w-md text-center text-[13px] text-label-secondary">
          The ML models live in <span className="font-mono">models/</span> — see the README for how to train them.
        </p>
      </div>
    );
  }

  if (status === "loading" && !analysis) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-accent-blue" />
        <p className="text-[13px] text-label-secondary">Scoring this case&apos;s conversations…</p>
      </div>
    );
  }

  if (!analysis) return null;

  const threadsTriage = analysis.threads.filter((t) => t.flag_triage).length;
  const peopleTuned = analysis.actors.filter((a) => a.flag_tuned).length;
  const peopleTriage = analysis.actors.filter((a) => a.flag_triage).length;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Model + summary ── */}
      <section className="rounded-card border border-separator bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-label-primary">
            <BrainCircuit className="size-4 text-accent-blue" />
            Machine-learning analysis
            <span className="text-[12px] font-normal text-label-tertiary">(trained on PAN 2012)</span>
          </h2>
          <div className="flex items-center gap-3">
            {status === "loading" && <Loader2 className="size-4 animate-spin text-accent-blue" />}
            <label className="flex items-center gap-1.5 text-[13px] text-label-secondary">
              Model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-control border border-separator bg-canvas px-2 py-1.5 text-[13px] text-label-primary outline-none"
              >
                {(live.length ? live : [{ id: model, label: model } as MlModelSummary]).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href="/models"
              className="flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline"
            >
              Model performance
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-separator pt-3">
          <StatItem dot="bg-accent-blue" label="Threads analysed" value={String(analysis.thread_count)} />
          <StatItem dot="bg-label-tertiary" label="Messages" value={String(analysis.message_count)} />
          <StatItem dot="bg-accent-amber" label="Threads over 0.5" value={String(threadsTriage)} />
          <StatItem dot="bg-accent-red" label="People flagged (tuned)" value={String(peopleTuned)} />
          <StatItem dot="bg-accent-amber" label="People flagged (triage)" value={String(peopleTriage)} />
          {summary && (
            <StatItem dot="bg-accent-green" label="Benchmark F0.5" value={fmt(summary.author["f0.5"])} />
          )}
          <StatItem dot="bg-label-tertiary" label="Run time" value={`${analysis.latency_ms} ms`} />
        </div>

        <p className="mt-3 flex gap-2 rounded-xl bg-accent-amber/[0.08] p-3 text-[12px] leading-relaxed text-label-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0 text-accent-amber" />
          <span>
            These models learned from PAN12 — long, 2000s-era English chats. On short, modern
            messages the <span className="font-medium text-label-primary">thread score</span> is
            unreliable (near chance in our tests); the{" "}
            <span className="font-medium text-label-primary">ranked instigator</span> inside a thread
            transfers well (94–100%). Use these as leads to review, never as findings.
          </span>
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Threads ── */}
        <section className="min-w-0 rounded-card border border-separator bg-surface p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-label-primary">Conversation threads</h3>
            <span className="text-[12px] text-label-tertiary">ranked by thread score</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {analysis.threads.map((t) => (
              <ThreadCard
                key={t.thread_id}
                thread={t}
                t1={analysis.thresholds.t1}
                t2={analysis.thresholds.t2}
                onOpen={onSelectArtifact}
              />
            ))}
          </div>
        </section>

        {/* ── People + how to read ── */}
        <div className="flex flex-col gap-5">
          <section className="rounded-card border border-separator bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-label-primary">
              <Users className="size-4 text-label-tertiary" />
              People
            </h3>
            <p className="mt-0.5 text-[12px] text-label-tertiary">Highest participant score in any thread</p>
            <ul className="mt-3 flex flex-col gap-3">
              {analysis.actors.map((a) => (
                <li key={a.actor_id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-label-primary" title={a.label}>
                      {a.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {a.flag_tuned ? (
                        <Chip tone="red">Flagged · tuned</Chip>
                      ) : a.flag_triage ? (
                        <Chip tone="amber">Flagged · triage</Chip>
                      ) : null}
                      <span className="font-mono text-[12px] text-label-primary">
                        {fmt(a.max_participant_score, 2)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar value={a.max_participant_score} />
                  </div>
                  <p className="mt-1 text-[11px] text-label-tertiary">
                    {a.threads} thread{a.threads === 1 ? "" : "s"}
                    {a.ranked_instigator_in > 0 && ` · ranked instigator in ${a.ranked_instigator_in}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-separator bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-label-primary">How the scores work</h3>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-label-secondary">
              <li className="flex gap-1.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
                <span>
                  <b className="text-label-primary">Thread score</b> — stage 1: does the conversation
                  look like grooming?
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
                <span>
                  <b className="text-label-primary">Participant score</b> — stage 2: which side is
                  driving it, the instigator or the person receiving it.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
                <span>
                  <b className="text-label-primary">Tuned</b> uses the model&apos;s benchmark thresholds
                  (t1 {fmt(analysis.thresholds.t1)}, t2 {fmt(analysis.thresholds.t2)});{" "}
                  <b className="text-label-primary">triage</b> uses 0.5.
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>

      {/* ── Model agreement ── */}
      <section className="rounded-card border border-separator bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-label-primary">Model agreement on this case</h3>
            <p className="mt-0.5 text-[12px] text-label-tertiary">
              Every trained model over the same threads
              {compare?.ground_truth_offender &&
                ` — scored against this demo bundle's answer key (offender: ${compare.ground_truth_offender})`}
            </p>
          </div>
          <Button variant="secondary" onClick={runCompare} disabled={comparing} className="!px-4 !py-1.5 !text-[13px]">
            {comparing && <Loader2 className="size-3.5 animate-spin" />}
            {compare ? "Re-run all models" : "Compare all models"}
          </Button>
        </div>

        {compare && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-separator text-[11px] text-label-tertiary">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Top-ranked person</th>
                  <th className="py-2 pr-3 font-medium">Flagged · tuned</th>
                  <th className="py-2 pr-3 font-medium">Flagged · triage</th>
                  {compare.ground_truth_offender && (
                    <>
                      <th className="py-2 pr-3 font-medium">Offender rank</th>
                      <th className="py-2 pr-3 font-medium">False flags (triage)</th>
                    </>
                  )}
                  <th className="py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {compare.models.map((r) => (
                  <tr key={r.model} className="border-b border-separator last:border-0 text-[12px]">
                    <td className="py-2.5 pr-3 font-medium text-label-primary">{r.label}</td>
                    <td className="py-2.5 pr-3 text-label-secondary">
                      {r.top_actor}{" "}
                      <span className="font-mono text-label-tertiary">{fmt(r.top_actor_score, 2)}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-label-secondary">{r.actors_flagged_tuned.join(", ") || "—"}</td>
                    <td className="py-2.5 pr-3 text-label-secondary">{r.actors_flagged_triage.join(", ") || "—"}</td>
                    {compare.ground_truth_offender && r.truth && (
                      <>
                        <td className="py-2.5 pr-3">
                          <span className="inline-flex items-center gap-1">
                            {r.truth.offender_rank === 1 ? (
                              <Check className="size-3.5 text-accent-green" />
                            ) : (
                              <X className="size-3.5 text-accent-red" />
                            )}
                            <span className="text-label-primary">#{r.truth.offender_rank ?? "—"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {r.truth.false_flags_triage.length ? (
                            <span className="text-accent-red">{r.truth.false_flags_triage.join(", ")}</span>
                          ) : (
                            <span className="text-accent-green">none</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 text-right font-mono text-label-tertiary">{r.latency_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ThreadCard({
  thread,
  t1,
  t2,
  onOpen,
}: {
  thread: MlThread;
  t1: number;
  t2: number;
  onOpen?: (artifactId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-separator bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-label-primary">
            <MessageCircle className="size-3.5 text-label-tertiary" />
            {thread.participants.join(" ↔ ")}
          </p>
          <p className="mt-0.5 text-[11px] text-label-tertiary">
            {thread.message_count} messages · {thread.sources.join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {thread.flag_tuned ? (
            <Chip tone="red">Over tuned t1</Chip>
          ) : thread.flag_triage ? (
            <Chip tone="amber">Over 0.5</Chip>
          ) : (
            <Chip tone="neutral">Below 0.5</Chip>
          )}
          <span className="font-mono text-[15px] font-semibold text-label-primary">{pct(thread.score, 0)}</span>
        </div>
      </div>

      <div className="mt-3">
        <ScoreBar
          value={thread.score}
          ticks={[
            { at: 0.5, label: "triage 0.5" },
            { at: t1, label: `tuned t1 ${t1}` },
          ]}
        />
      </div>

      {thread.authors.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {thread.authors.map((a, i) => (
            <div key={a.actor_id} className="rounded-control border border-separator bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-label-primary">{a.label}</span>
                  {i === 0 && thread.authors.length > 1 && <Chip tone="blue">Ranked instigator</Chip>}
                </span>
                <span className="font-mono text-[12px] text-label-primary">{fmt(a.score, 2)}</span>
              </div>
              <div className="mt-1.5">
                <ScoreBar value={a.score} ticks={[{ at: t2, label: `tuned t2 ${t2}` }]} />
              </div>
              <div className="mt-1.5">
                <SignalChips signals={a.signals} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {thread.top_terms.length > 0 && (
            <span className="text-[11px] text-label-tertiary">Score driven by</span>
          )}
          {thread.top_terms.slice(0, 5).map((t, i) => (
            <span
              key={`${i}-${t.term}`}
              className="rounded-full border border-separator px-2 py-0.5 font-mono text-[10px] text-label-secondary"
            >
              {t.term}
            </span>
          ))}
        </div>
        {onOpen && thread.artifact_ids[0] && (
          <button
            onClick={() => onOpen(thread.artifact_ids[0])}
            className="flex items-center gap-0.5 text-[12px] font-medium text-accent-blue hover:underline"
          >
            Open in timeline
            <ArrowUpRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function SignalChips({ signals }: { signals: SignalHits }) {
  const keys = Object.keys(signals);
  if (!keys.length) return <span className="text-[11px] text-label-tertiary">No behaviour signals</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <span
          key={k}
          title={signals[k].join(", ")}
          className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10px] font-medium text-accent-amber"
        >
          {SIGNAL_LABELS[k] ?? k} ×{signals[k].length}
        </span>
      ))}
    </div>
  );
}

function Chip({ tone, children }: { tone: "red" | "amber" | "blue" | "neutral"; children: React.ReactNode }) {
  const styles = {
    red: "bg-accent-red/10 text-accent-red",
    amber: "bg-accent-amber/10 text-accent-amber",
    blue: "bg-accent-blue/10 text-accent-blue",
    neutral: "bg-label-tertiary/15 text-label-secondary",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[tone]}`}>{children}</span>
  );
}

function StatItem({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="text-label-tertiary">{label}</span>
      <span className="font-semibold text-label-primary">{value}</span>
    </span>
  );
}

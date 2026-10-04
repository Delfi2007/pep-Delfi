"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CurveChart, HBarChart, SERIES_COLORS } from "@/components/ml/MlCharts";
import { getJson } from "@/lib/fetchJson";
import {
  fmt,
  int,
  pct,
  type Metrics,
  type MlDatasets,
  type MlModelDetail,
  type MlModelSummary,
} from "@/lib/mlTypes";

/**
 * Model performance — how each trained model did on the official PAN 2012
 * test set, and how it holds up on chats written in a different style.
 *
 * Every number is read from results/*.json, written by the training scripts
 * in ml/. Nothing here is computed in the browser except layout, so the page
 * cannot drift from the files the README and RESULTS.md cite.
 */
type Level = "author" | "stage1" | "stage2";

const LEVELS: { value: Level; label: string }[] = [
  { value: "author", label: "Person" },
  { value: "stage1", label: "Conversation" },
  { value: "stage2", label: "Instigator" },
];

const LEVEL_NOTE: Record<Level, string> = {
  author:
    "Official PAN12 task: 218,702 test users, 254 predators. A person is flagged if any of their chats passes both thresholds.",
  stage1:
    "155,128 test conversations, 3,737 contain a predator. Scored at each model's tuned t1 — deliberately strict, so recall here looks low.",
  stage2: "5,624 participants of predator conversations: is this side the predator or the person receiving it? Threshold 0.5.",
};

const COLS: { key: keyof Metrics; label: string }[] = [
  { key: "accuracy", label: "Accuracy" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
  { key: "f1", label: "F1" },
  { key: "f0.5", label: "F0.5" },
  { key: "roc_auc", label: "ROC-AUC" },
  { key: "pr_auc", label: "PR-AUC" },
];

export function ModelPerformanceView() {
  const [models, setModels] = useState<MlModelSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, MlModelDetail>>({});
  const [datasets, setDatasets] = useState<MlDatasets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("author");
  const [curve, setCurve] = useState<"pr" | "roc">("pr");
  const [selected, setSelected] = useState("distilbert");
  const [opIndex, setOpIndex] = useState<number | null>(null);

  useEffect(() => {
    getJson<MlModelSummary[]>("/api/ml/models")
      .then(async (ms) => {
        setModels(ms);
        const pairs = await Promise.all(
          ms.map((m) => getJson<MlModelDetail>(`/api/ml/models/${m.id}`).then((d) => [m.id, d] as const)),
        );
        setDetails(Object.fromEntries(pairs));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load models"));
    getJson<MlDatasets>("/api/ml/datasets").then(setDatasets).catch(() => setDatasets(null));
  }, []);

  const colorOf = useMemo(() => {
    const map: Record<string, string> = {};
    (models ?? []).forEach((m, i) => (map[m.id] = SERIES_COLORS[i % SERIES_COLORS.length]));
    return map;
  }, [models]);

  if (error) return <p className="text-[13px] text-accent-red">Failed to load model results — {error}</p>;
  if (!models) return <p className="text-[13px] text-label-secondary">Loading model results…</p>;

  const rows = models.map((m) => ({ m, x: m[level] as Metrics }));
  const best: Partial<Record<keyof Metrics, number>> = {};
  for (const c of COLS) best[c.key] = Math.max(...rows.map((r) => (r.x[c.key] as number | undefined) ?? -1));

  const top = [...models].sort((a, b) => b.author["f0.5"] - a.author["f0.5"])[0];
  const sel = details[selected];
  const selSummary = models.find((m) => m.id === selected);
  const ops = sel?.operating_points ?? [];
  const tunedIdx = Math.max(0, ops.findIndex((o) => o.t2 === sel?.thresholds.t2_stage2));
  const op = ops[opIndex ?? tunedIdx];

  return (
    <div className="flex flex-col gap-5">
      {/* ── Headline ── */}
      <section className="rounded-card border border-separator bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Headline label="Best model (F0.5)" value={fmt(top.author["f0.5"])} sub={top.label} tone="text-accent-blue" />
          <Headline
            label="Precision · recall"
            value={`${pct(top.author.precision, 0)} · ${pct(top.author.recall, 0)}`}
            sub="Person level, official test set"
          />
          <Headline
            label="Found · false alarms"
            value={`${top.author.confusion_matrix.tp} · ${top.author.confusion_matrix.fp}`}
            sub={`of 254 predators among 218,702 users`}
          />
          <Headline label="Models trained" value={String(models.length)} sub="Classical, transformer, ensemble, domain-adapted" />
        </div>
        <p className="mt-4 flex gap-2 border-t border-separator pt-3 text-[12px] leading-relaxed text-label-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Accuracy is above 0.999 for every model and says little: 99.88% of users are not predators, so a model that
            flags nobody scores 99.88%. Compare on F0.5 (the official PAN12 metric — precision weighted over recall,
            because a false accusation is the costlier error), PR-AUC and recall. The best published PAN 2012 system
            scored about 0.93 F0.5.
          </span>
        </p>
      </section>

      {/* ── Metrics table ── */}
      <section className="rounded-card border border-separator bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-label-primary">Test-set metrics</h3>
            <p className="mt-0.5 max-w-3xl text-[12px] text-label-tertiary">{LEVEL_NOTE[level]}</p>
          </div>
          <SegmentedControl options={LEVELS} value={level} onChange={setLevel} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead>
              <tr className="border-b border-separator text-[11px] text-label-tertiary">
                <th className="py-2 pr-3 font-medium">Model</th>
                {COLS.map((c) => (
                  <th key={c.key} className="py-2 pr-3 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-medium">ECE</th>
                <th className="py-2 pr-3 text-right font-medium">Size</th>
                <th className="py-2 text-right font-medium">ms / chat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, x }) => (
                <tr
                  key={m.id}
                  onClick={() => {
                    setSelected(m.id);
                    setOpIndex(null);
                  }}
                  className={`cursor-pointer border-b border-separator text-[12px] transition-colors last:border-0 hover:bg-canvas ${
                    selected === m.id ? "bg-canvas" : ""
                  }`}
                >
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf[m.id] }} />
                      <span className="font-medium text-label-primary">{m.label}</span>
                      {m.id.endsWith("_aug") && (
                        <span className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10px] font-medium text-accent-amber">
                          + synthetic
                        </span>
                      )}
                    </span>
                  </td>
                  {COLS.map((c) => {
                    const v = x[c.key] as number | undefined;
                    const isBest = v != null && v === best[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`py-2.5 pr-3 text-right font-mono ${
                          isBest ? "font-semibold text-accent-blue" : "text-label-primary"
                        }`}
                      >
                        {fmt(v, 4)}
                      </td>
                    );
                  })}
                  <td className="py-2.5 pr-3 text-right font-mono text-label-secondary">
                    {fmt(level === "stage2" ? m.ece_stage2 : m.ece_stage1)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono text-label-secondary">
                    {m.model_size_mb != null ? `${m.model_size_mb} MB` : "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-label-secondary">{fmt(m.ms_per_conversation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-label-tertiary">
          Best value per column in blue. ECE = expected calibration error (lower means the probabilities can be taken at
          face value). Select a row to inspect that model below.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">F0.5 leaderboard</h3>
          <p className="mt-0.5 text-[12px] text-label-tertiary">Person level, official PAN12 test set</p>
          <div className="mt-4">
            <HBarChart
              rows={[...models]
                .sort((a, b) => b.author["f0.5"] - a.author["f0.5"])
                .map((m) => ({ label: m.label, value: m.author["f0.5"], color: colorOf[m.id] }))}
              highlight={selSummary?.label}
            />
          </div>
        </section>

        <section className="rounded-card border border-separator bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-label-primary">
                {curve === "pr" ? "Precision–recall curves" : "ROC curves"}
              </h3>
              <p className="mt-0.5 text-[12px] text-label-tertiary">
                {LEVELS.find((l) => l.value === level)?.label} level · selected model drawn bold
              </p>
            </div>
            <SegmentedControl
              options={[
                { value: "pr", label: "PR" },
                { value: "roc", label: "ROC" },
              ]}
              value={curve}
              onChange={setCurve}
            />
          </div>
          <div className="mt-3">
            <CurveChart
              xLabel={curve === "pr" ? "Recall" : "False positive rate"}
              yLabel={curve === "pr" ? "Precision" : "True positive rate"}
              diagonal={curve === "roc"}
              series={models
                .filter((m) => details[m.id]?.curves)
                .map((m) => {
                  const c = details[m.id].curves![level];
                  return curve === "pr"
                    ? { id: m.id, label: m.label, color: colorOf[m.id], xs: c.pr.recall, ys: c.pr.precision, bold: m.id === selected }
                    : { id: m.id, label: m.label, color: colorOf[m.id], xs: c.roc.fpr, ys: c.roc.tpr, bold: m.id === selected };
                })}
            />
          </div>
        </section>
      </div>

      {selSummary && (
        <div className="grid gap-5 xl:grid-cols-3">
          <section className="rounded-card border border-separator bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-label-primary">Confusion matrix</h3>
            <p className="mt-0.5 text-[12px] text-label-tertiary">{selSummary.label} · person level</p>
            <ConfusionMatrix cm={selSummary.author.confusion_matrix} />
            <p className="mt-3 text-[11px] text-label-tertiary">
              Thresholds t1 = {selSummary.thresholds.t1_stage1}, t2 = {selSummary.thresholds.t2_stage2}, tuned on a
              validation split of unseen predators and then frozen.
            </p>
          </section>

          <section className="rounded-card border border-separator bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-label-primary">Operating point</h3>
            <p className="mt-0.5 text-[12px] text-label-tertiary">Move the participant threshold (t2)</p>
            {ops.length > 0 && op ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={ops.length - 1}
                  value={opIndex ?? tunedIdx}
                  onChange={(e) => setOpIndex(Number(e.target.value))}
                  aria-label="Participant threshold"
                  className="mt-4 w-full accent-[var(--accent-blue)]"
                />
                <div className="mt-1 flex justify-between text-[11px] text-label-tertiary">
                  <span>{ops[0].t2}</span>
                  <span className="font-medium text-accent-blue">
                    t2 = {op.t2}
                    {op.t2 === sel?.thresholds.t2_stage2 && " (tuned)"}
                  </span>
                  <span>{ops[ops.length - 1].t2}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ["Precision", pct(op.precision)],
                    ["Recall", pct(op.recall)],
                    ["F0.5", fmt(op["f0.5"])],
                    ["Predators found", String(op.tp)],
                    ["False alarms", String(op.fp)],
                    ["F1", fmt(op.f1)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-control bg-canvas px-3 py-2">
                      <p className="text-[11px] text-label-tertiary">{k}</p>
                      <p className="mt-0.5 font-mono text-[14px] font-semibold text-label-primary">{v}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-[12px] text-label-tertiary">Loading…</p>
            )}
          </section>

          <section className="rounded-card border border-separator bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-label-primary">Calibration</h3>
            <p className="mt-0.5 text-[12px] text-label-tertiary">
              Conversation level · ECE {fmt(sel?.calibration?.stage1.ece)} · Brier {fmt(sel?.calibration?.stage1.brier, 4)}
            </p>
            {sel?.calibration ? (
              <div className="mt-3">
                <CurveChart
                  xLabel="Predicted probability"
                  yLabel="Observed rate"
                  diagonal
                  height={210}
                  series={[
                    {
                      id: "rel",
                      label: "reliability",
                      color: colorOf[selected],
                      bold: true,
                      xs: sel.calibration.stage1.reliability.map((r) => r.confidence),
                      ys: sel.calibration.stage1.reliability.map((r) => r.accuracy),
                    },
                  ]}
                />
                <p className="mt-1 text-[11px] text-label-tertiary">On the dashed diagonal = probabilities mean what they say.</p>
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-label-tertiary">Loading…</p>
            )}
          </section>
        </div>
      )}

      {/* ── Domain shift ── */}
      {datasets && (
        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">Does it transfer? — modern-style chats</h3>
          <p className="mt-0.5 max-w-4xl text-[12px] text-label-tertiary">
            600 synthetic chats (150 grooming-pattern, 450 benign) written from phrase templates no model saw in training.
            Models marked “+ synthetic” were also trained on a separate synthetic pool with disjoint wording.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-separator text-[11px] text-label-tertiary">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 text-right font-medium">PAN12 F0.5</th>
                  <th className="py-2 pr-3 text-right font-medium">Synthetic ROC-AUC</th>
                  <th className="py-2 pr-3 text-right font-medium">Precision @0.5</th>
                  <th className="py-2 pr-3 text-right font-medium">Recall @0.5</th>
                  <th className="py-2 text-right font-medium">Instigator identified</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(datasets.synthetic_eval.results).map(([id, r]) => {
                  const m = models.find((x) => x.id === id);
                  const auc = r["at_0.5"].roc_auc ?? 0;
                  return (
                    <tr key={id} className="border-b border-separator text-[12px] last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-label-primary">{m?.label ?? id}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-label-secondary">{fmt(m?.author["f0.5"])}</td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono font-semibold ${
                          auc >= 0.7 ? "text-accent-green" : auc < 0.45 ? "text-accent-red" : "text-label-primary"
                        }`}
                      >
                        {fmt(r["at_0.5"].roc_auc)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-label-secondary">{fmt(r["at_0.5"].precision)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-label-secondary">{fmt(r["at_0.5"].recall)}</td>
                      <td className="py-2.5 text-right font-mono text-label-primary">{pct(r.stage2_instigator_accuracy, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-label-secondary">
            <li className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
              Spotting a suspicious <b className="text-label-primary">conversation</b> does not transfer: most models fall to
              roughly chance (0.5), and word-level Naive Bayes is inverted. Character n-grams transfer best.
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
              Identifying the <b className="text-label-primary">instigator</b> inside a grooming chat transfers almost
              perfectly — which is why the case ML view leads with it.
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
              Before operational use, models must be retrained and validated on sanitised Kerala case data, including
              Malayalam and Manglish.
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Headline({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div>
      <p className="text-[12px] text-label-tertiary">{label}</p>
      <p className={`mt-1 text-[24px] font-bold tracking-tight ${tone ?? "text-label-primary"}`}>{value}</p>
      <p className="mt-0.5 text-[12px] text-label-secondary">{sub}</p>
    </div>
  );
}

function ConfusionMatrix({ cm }: { cm: { tn: number; fp: number; fn: number; tp: number } }) {
  const cell = (v: number, label: string, cls: string) => (
    <div className={`rounded-control p-3 text-center ${cls}`}>
      <p className="font-mono text-[18px] font-semibold text-label-primary">{int(v)}</p>
      <p className="mt-0.5 text-[11px] text-label-secondary">{label}</p>
    </div>
  );
  return (
    <div className="mt-3 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-[11px]">
      <span />
      <span className="text-center text-label-tertiary">Flagged</span>
      <span className="text-center text-label-tertiary">Not flagged</span>
      <span className="pr-1 text-right text-label-tertiary">Predator</span>
      {cell(cm.tp, "found", "bg-accent-green/10")}
      {cell(cm.fn, "missed", "bg-accent-amber/10")}
      <span className="pr-1 text-right text-label-tertiary">Not</span>
      {cell(cm.fp, "false alarm", "bg-accent-red/10")}
      {cell(cm.tn, "correctly cleared", "bg-canvas")}
    </div>
  );
}

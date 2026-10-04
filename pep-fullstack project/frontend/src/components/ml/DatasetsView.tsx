"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { HBarChart, YearBars } from "@/components/ml/MlCharts";
import { getJson } from "@/lib/fetchJson";
import { fmt, int, pct, type MlDatasets, type MlGov, type MlHashing } from "@/lib/mlTypes";

/**
 * Datasets & statistics — every dataset behind the ML layer, plus the
 * official figures that frame the problem.
 *
 * Real chat text from PAN12 is never shown here or anywhere in the console:
 * the backend only ever serves counts and metrics derived from it.
 */
export function DatasetsView() {
  const [ds, setDs] = useState<MlDatasets | null>(null);
  const [gov, setGov] = useState<MlGov | null>(null);
  const [hashing, setHashing] = useState<MlHashing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<MlDatasets>("/api/ml/datasets"),
      getJson<MlGov>("/api/ml/gov"),
      getJson<MlHashing>("/api/ml/hashing"),
    ])
      .then(([d, g, h]) => {
        setDs(d);
        setGov(g);
        setHashing(h);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load datasets"));
  }, []);

  if (error) return <p className="text-[13px] text-accent-red">Failed to load datasets — {error}</p>;
  if (!ds || !gov || !hashing) return <p className="text-[13px] text-label-secondary">Loading datasets…</p>;

  const p = ds.pan12;
  const test = p.splits.find((s) => s.split.startsWith("test"));
  const ncrb = gov.ncrb;
  const first = ncrb.national[0];
  const last = ncrb.national[ncrb.national.length - 1];
  const later = ncrb.reported_later[0];
  const states = [...ncrb.states_latest].filter((s) => s.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
  const kerala = ncrb.states_latest.find((s) => s.state === "Kerala");
  const keralaRank = [...ncrb.states_latest].sort((a, b) => b.total - a.total).findIndex((s) => s.state === "Kerala") + 1;
  const ncmecIndia = gov.ncmec.years.map((y) => ({ label: String(y.year), value: y.countries.India ?? 0 }));
  const hashOrder = ["sha256", "ahash", "dhash", "phash"];

  return (
    <div className="flex flex-col gap-5">
      {/* ── Sources ── */}
      <section className="rounded-card border border-separator bg-surface p-4">
        <h3 className="text-[14px] font-semibold text-label-primary">Data used by the ML layer</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-separator text-[11px] text-label-tertiary">
                <th className="py-2 pr-3 font-medium">Dataset</th>
                <th className="py-2 pr-3 font-medium">Kind</th>
                <th className="py-2 pr-3 font-medium">Used for</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {[
                { name: p.name, kind: "Real chats · adult decoys", tone: "blue", use: "Training and testing every model", url: p.source },
                { name: "NCRB Crime in India, Table 9A.11", kind: "Government of India", tone: "green", use: "Official statistics below", url: ncrb.source.url },
                { name: "NCMEC CyberTipline reports by country", kind: "Official statistics", tone: "green", use: "Official statistics below", url: gov.ncmec.source.url },
                { name: "Synthetic chats (2 pools, 1,800)", kind: "Generated · non-explicit", tone: "amber", use: "Domain adaptation and transfer test", url: "" },
                { name: "Synthetic images (400)", kind: "Generated · benign", tone: "amber", use: "Hashing robustness experiment", url: "" },
              ].map((r) => (
                <tr key={r.name} className="border-b border-separator last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-label-primary">{r.name}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.tone === "blue"
                          ? "bg-accent-blue/10 text-accent-blue"
                          : r.tone === "green"
                            ? "bg-accent-green/10 text-accent-green"
                            : "bg-accent-amber/10 text-accent-amber"
                      }`}
                    >
                      {r.kind}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-label-secondary">{r.use}</td>
                  <td className="py-2.5">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-blue hover:underline">
                        Link <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-mono text-[11px] text-label-tertiary">ml/</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── PAN12 ── */}
      <section className="rounded-card border border-separator bg-surface p-4">
        <h3 className="text-[14px] font-semibold text-label-primary">{p.name}</h3>
        <p className="mt-0.5 text-[12px] text-label-tertiary">
          {int(test?.authors)} test users, {int(test?.predators)} predators ({test?.predator_rate_pct}%) — the class imbalance
          every metric has to be read against.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-separator text-[11px] text-label-tertiary">
                {["Split", "Conversations", "With predator", "Users", "Predators", "Messages"].map((h, i) => (
                  <th key={h} className={`py-2 pr-3 font-medium ${i ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {p.splits.map((s) => (
                <tr key={s.split} className="border-b border-separator last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-label-primary">{s.split}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{int(s.conversations)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{int(s.conversations_with_predator)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{int(s.authors)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono text-accent-blue">{int(s.predators)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{int(s.messages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-label-secondary">
          {p.notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-label-tertiary" />
              {n}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Government statistics ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">Cyber crimes against children — India</h3>
          <p className="mt-0.5 text-[12px] text-label-tertiary">
            NCRB, cases registered {first.year}–{last.year}
            {later && ` (${later.year} as reported)`}
          </p>
          <div className="mt-4">
            <YearBars
              data={[
                ...ncrb.national.map((n) => ({ label: String(n.year), value: n.total })),
                ...ncrb.reported_later.map((r) => ({ label: String(r.year), value: r.total, muted: true })),
              ]}
            />
          </div>
          <p className="mt-3 text-[12px] text-label-secondary">
            {int(first.total)} cases in {first.year} → {int(last.total)} in {last.year}. Fitted growth{" "}
            <span className="font-semibold text-label-primary">{ncrb.trend.annual_growth_pct}% a year</span> — partly more
            offending, partly better reporting.
          </p>
        </section>

        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">Kerala</h3>
          <p className="mt-0.5 text-[12px] text-label-tertiary">
            NCRB, cases registered · {ncrb.latest_year}: rank {keralaRank} of {ncrb.states_latest.length} States/UTs,{" "}
            {kerala?.rate_per_lakh_children} per lakh children
          </p>
          <div className="mt-4">
            <YearBars data={ncrb.kerala.map((k) => ({ label: String(k.year), value: k.total }))} color="var(--accent-indigo)" />
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">Top States/UTs · {ncrb.latest_year}</h3>
          <p className="mt-0.5 text-[12px] text-label-tertiary">{ncrb.source.caveat}</p>
          <div className="mt-4">
            <HBarChart
              rows={states.map((s) => ({
                label: s.state,
                value: s.total,
                color: s.state === "Kerala" ? "var(--accent-indigo)" : "var(--accent-blue)",
              }))}
              max={states[0]?.total ?? 1}
              format={(v) => v.toLocaleString("en-IN")}
              highlight="Kerala"
            />
          </div>
        </section>

        <section className="rounded-card border border-separator bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-label-primary">State clusters · k-means (k = {ncrb.clusters.k})</h3>
          <p className="mt-0.5 text-[12px] text-label-tertiary">{ncrb.clusters.features}</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {ncrb.clusters.items.map((c) => (
              <div key={c.cluster} className="rounded-xl bg-canvas p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-label-primary">Cluster {c.cluster + 1}</span>
                  <span className="font-mono text-[11px] text-label-secondary">
                    {fmt(c.mean_rate_per_lakh_children, 2)} per lakh children
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-label-tertiary">Dominant: {c.dominant_crime_head}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-label-secondary">
                  {c.states.map((s, i) => (
                    <span key={s} className={s === "Kerala" ? "font-semibold text-accent-indigo" : ""}>
                      {s}
                      {i < c.states.length - 1 && ", "}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-card border border-separator bg-surface p-4">
        <h3 className="text-[14px] font-semibold text-label-primary">CyberTipline reports attributed to India</h3>
        <p className="mt-0.5 max-w-4xl text-[12px] text-label-tertiary">{gov.ncmec.source.caveat}</p>
        <div className="mt-4">
          <YearBars data={ncmecIndia} color="var(--accent-amber)" format={(v) => `${(v / 1e6).toFixed(2)}M`} />
        </div>
      </section>

      {/* ── Hashing ── */}
      <section className="rounded-card border border-separator bg-surface p-4">
        <h3 className="text-[14px] font-semibold text-label-primary">Image hashing robustness</h3>
        <p className="mt-0.5 max-w-4xl text-[12px] text-label-tertiary">
          {hashing.n_images} generated benign images, each edited 16 ways (re-compression, resizing, crops, rotation,
          colour changes, overlays). Match = Hamming distance ≤ {hashing.threshold} of 64 bits. False matches measured on{" "}
          {int(hashing.n_impostor_pairs)} pairs of different images.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {hashOrder.map((h) => {
            const s = hashing.summary[h];
            return (
              <div key={h} className="rounded-xl bg-canvas p-3">
                <p className="text-[12px] text-label-tertiary">{hashing.hashes[h]}</p>
                <p className={`mt-1 text-[22px] font-bold ${h === "sha256" ? "text-accent-red" : "text-label-primary"}`}>
                  {pct(s.overall_match_rate, 0)}
                </p>
                <p className="text-[11px] text-label-secondary">
                  edited copies matched · false-match {pct(s.false_match_rate, 2)}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-separator text-[11px] text-label-tertiary">
                <th className="py-2 pr-3 font-medium">Edit</th>
                {hashOrder.map((h) => (
                  <th key={h} className="py-2 pr-3 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {Object.keys(hashing.transforms).map((t) => (
                <tr key={t} className="border-b border-separator last:border-0">
                  <td className="py-2 pr-3 text-label-secondary">{hashing.transforms[t]}</td>
                  {hashOrder.map((h) => {
                    const v = hashing.per_transform[h][t]?.match_rate ?? 0;
                    return (
                      <td
                        key={h}
                        className={`py-2 pr-3 text-right font-mono ${
                          v >= 0.9 ? "text-accent-green" : v >= 0.4 ? "text-accent-amber" : "text-accent-red"
                        }`}
                      >
                        {pct(v, 0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex gap-2 text-[12px] leading-relaxed text-label-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This is why ACPIA matches images on pHash as well as SHA-256: a re-saved copy defeats a cryptographic hash.
            Reference hash lists themselves (NCMEC, INTERPOL ICSE) are law-enforcement-only and are not used.
          </span>
        </p>
      </section>
    </div>
  );
}

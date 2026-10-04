"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderPlus, Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Case } from "@/lib/types";

export default function CasesPage() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/cases")
      .then((res) => res.json())
      .then((data) => setCases(Array.isArray(data) ? data : []))
      .catch(() => setCases([]));
  }, []);

  const filtered = useMemo(() => {
    if (!cases) return null;
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) =>
      [c.title, c.fir_number, c.station, c.investigating_officer]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [cases, query]);

  return (
    <div className="w-full p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-label-primary">
            Cases
          </h1>
          <p className="mt-0.5 text-[13px] text-label-secondary">
            Every investigation on this instance.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-tertiary" />
          {/* Scoped to case fields on purpose — full-text search across
              artifacts isn't built yet, and a box that silently searches
              less than it implies is worse than one that says what it does. */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, FIR, station, officer…"
            className="w-72 rounded-full border border-separator bg-surface py-2 pl-9 pr-3 text-[13px] text-label-primary placeholder:text-label-tertiary focus:border-accent-blue focus:outline-none"
          />
        </div>
      </div>

      {filtered === null && (
        <p className="text-[13px] text-label-secondary">Loading cases…</p>
      )}

      {filtered?.length === 0 && cases?.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <FolderPlus className="size-8 text-label-tertiary" />
          <p className="text-[17px] font-semibold text-label-primary">No cases yet</p>
          <p className="max-w-xs text-[13px] text-label-secondary">
            Open a case, then drop in the evidence bundle for that case.
          </p>
          <Link href="/cases/new">
            <Button className="mt-2">Open a case</Button>
          </Link>
        </Card>
      )}

      {filtered?.length === 0 && (cases?.length ?? 0) > 0 && (
        <p className="text-[13px] text-label-secondary">
          No case matches “{query}”.
        </p>
      )}

      {filtered && filtered.length > 0 && (
        <Card>
          <div className="divide-y divide-separator">
            {filtered.map((c) => (
              <ListRow
                key={c.case_id}
                href={`/cases/${c.case_id}`}
                title={c.title}
                subtitle={
                  <span className="font-mono">{c.fir_number ?? c.case_id}</span>
                }
                trailing={
                  <div className="flex shrink-0 items-center gap-2">
                    {c.artifact_count > 0 && (
                      <span className="text-[13px] text-label-tertiary">
                        {c.artifact_count} artifacts
                      </span>
                    )}
                    {c.flagged_count > 0 && (
                      <span className="text-[13px] font-medium text-accent-amber">
                        {c.flagged_count} flagged
                      </span>
                    )}
                    <StatusBadge status={c.status} />
                  </div>
                }
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

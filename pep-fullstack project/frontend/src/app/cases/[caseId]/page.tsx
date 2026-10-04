"use client";

import { Suspense, useCallback, useEffect, useState, type DragEvent } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FolderUp, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { TabBar } from "@/components/ui/TabBar";
import { CaseHeader } from "@/components/cases/CaseHeader";
import { getJson } from "@/lib/fetchJson";
import type { Case, IngestResult, SignalProfile } from "@/lib/types";
import { collectFilesFromDataTransfer } from "@/lib/collectFiles";
import { TimelineView } from "@/components/timeline/TimelineView";
import { GraphView } from "@/components/graph/GraphView";
import { TriageView } from "@/components/triage/TriageView";
import { PersonsView, CONCERN_THRESHOLD } from "@/components/persons/PersonsView";
import { SearchView } from "@/components/search/SearchView";
import { ReportView } from "@/components/report/ReportView";
import { AlertsView } from "@/components/alerts/AlertsView";
import { AuditView } from "@/components/audit/AuditView";
import { MLAnalysisView } from "@/components/ml/MLAnalysisView";
import {
  CASE_VIEWS,
  DEFAULT_CASE_VIEW,
  TAB_VIEWS,
  caseViewLabel,
  isCaseView,
  type CaseView,
} from "@/lib/caseViews";

function CaseDetail() {
  const params = useParams<{ caseId: string }>();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The active view lives in the URL, not in component state. That is what
  // lets the sidebar link straight to a view, and what makes a case view
  // survive a reload or a shared link — both of which silently failed when
  // this was a useState.
  const viewParam = searchParams.get("view");
  const view: CaseView = isCaseView(viewParam) ? viewParam : DEFAULT_CASE_VIEW;

  const setView = useCallback(
    (next: CaseView) => {
      // replace, not push: flipping between views of one case shouldn't
      // stack up history entries an investigator has to click back through
      // to leave the case.
      router.replace(`${pathname}?view=${next}`, { scroll: false });
    },
    [router, pathname],
  );
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Set when a citation is clicked in Triage; consumed by TimelineView the
  // moment it mounts, which is the last beat of the demo script — click an
  // evidence ID, land on the source line.
  const [focusArtifactId, setFocusArtifactId] = useState<string | null>(null);
  // Feeds the header's stat strip. Fetched here rather than in PersonsView
  // because the strip is visible on every tab, and the signal profiles are
  // the only source for "how many actors are of concern" and "highest risk
  // score" — both of which would otherwise have to be invented.
  const [profiles, setProfiles] = useState<SignalProfile[] | null>(null);
  // Reported by AlertsView once loaded, so the header can show the open
  // count without issuing a second request for data that view already
  // holds. Cleared when leaving the tab — the tile shouldn't keep showing
  // an alert count while you're reading the timeline.
  const [openAlerts, setOpenAlerts] = useState<number | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/cases/${params.caseId}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error("Case not found")),
      )
      .then(setCaseData)
      .catch((err) => setLoadError(err.message));
  }, [params.caseId]);

  useEffect(() => {
    // A case with no evidence yet has no profiles; that's a legitimate
    // empty, not an error, so the strip just shows a dash.
    getJson<SignalProfile[]>(`/api/cases/${params.caseId}/signals`)
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [params.caseId]);

  // A case that already has artifacts (e.g. re-visited after ingest, or
  // loaded fresh on another tab) should show the view shell directly
  // instead of re-prompting for a folder drop.
  const alreadyIngested = caseData !== null && caseData.artifact_count > 0;
  const artifactCount = ingestResult?.artifact_count ?? caseData?.artifact_count ?? 0;
  const flaggedCount = ingestResult?.flagged_count ?? caseData?.flagged_count ?? 0;
  const showShell = alreadyIngested || ingestResult !== null;

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f, f.webkitRelativePath || f.name));

    setUploadStatus("loading");
    setUploadError(null);
    try {
      const res = await fetch(`/api/cases/${params.caseId}/ingest`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`Ingest failed (${res.status})`);
      const data: IngestResult = await res.json();
      setIngestResult(data);
      setUploadStatus("done");
      // Keep the case object in sync so a later reload reflects reality.
      setCaseData((prev) =>
        prev
          ? { ...prev, artifact_count: data.artifact_count, flagged_count: data.flagged_count }
          : prev,
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Ingest failed");
      setUploadStatus("error");
    }
  }

  async function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const files = await collectFilesFromDataTransfer(e.dataTransfer);
    handleFiles(files);
  }

  if (loadError) {
    return (
      <div className="w-full p-6">
        <p className="text-[15px] text-accent-red">{loadError}</p>
        <Link href="/" className="mt-2 inline-block text-[15px] text-accent-blue">
          Back to cases
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      {!caseData ? (
        <p className="p-6 text-[13px] text-label-secondary">Loading case…</p>
      ) : (
        <>
          <CaseHeader
            caseData={caseData}
            artifactCount={artifactCount}
            flaggedCount={flaggedCount}
            profiles={profiles}
            concernThreshold={CONCERN_THRESHOLD}
            viewLabel={caseViewLabel(view)}
            openAlerts={view === "alerts" ? openAlerts : undefined}
            onExport={() => {
              setFocusArtifactId(null);
              setView("report");
            }}
          />

          <div className="p-6">
          {!showShell ? (
            <Card className="mx-auto max-w-lg p-6">
              <label
                htmlFor="evidence-upload"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={`flex cursor-pointer flex-col items-center gap-3 rounded-control border border-dashed px-6 py-10 text-center transition-colors ${
                  dragActive ? "border-accent-blue bg-accent-blue/5" : "border-separator hover:border-accent-blue"
                }`}
              >
                {uploadStatus === "loading" ? (
                  <Loader2 className="size-6 animate-spin text-accent-blue" />
                ) : (
                  <FolderUp className="size-6 text-label-tertiary" />
                )}
                <span className="text-[15px] font-medium text-label-primary">
                  Drop the case folder here
                </span>
                <span className="text-[13px] text-label-secondary">
                  WhatsApp export, Instagram DMs, call logs, browser history, images —
                  or click to choose the folder
                </span>
                <input
                  id="evidence-upload"
                  type="file"
                  multiple
                  // @ts-expect-error -- non-standard but supported by Chrome/Edge/Firefox,
                  // lets an investigator pick the whole case folder in one action.
                  webkitdirectory=""
                  className="hidden"
                  onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {uploadStatus === "error" && (
                <p className="mt-4 text-[13px] text-accent-red">{uploadError}</p>
              )}
            </Card>
          ) : (
            <>
              <div className="mb-4">
                <TabBar
                  value={view}
                  onChange={(next) => {
                    // Switching tabs by hand drops any pending citation, so
                    // returning to the timeline later doesn't re-jump to a
                    // lead the investigator has moved on from.
                    setFocusArtifactId(null);
                    setView(next);
                  }}
                  options={CASE_VIEWS.filter((v) => TAB_VIEWS.includes(v.value)).map(
                    (v) => ({ value: v.value, label: v.tabLabel }),
                  )}
                />
              </div>

              {view === "timeline" && (
                <TimelineView
                  caseId={params.caseId}
                  focusArtifactId={focusArtifactId}
                />
              )}
              {view === "graph" && (
                <Card className="p-4">
                  <GraphView caseId={params.caseId} />
                </Card>
              )}
              {/* Not wrapped in a Card: this view lays out its own panels
                  plus a right-hand rail, so an outer card would put a box
                  around a box. */}
              {view === "people" && (
                <PersonsView
                  caseId={params.caseId}
                  onSelectArtifact={(artifactId) => {
                    setFocusArtifactId(artifactId);
                    setView("timeline");
                  }}
                  onOpenGraph={() => {
                    setFocusArtifactId(null);
                    setView("graph");
                  }}
                />
              )}
              {view === "search" && (
                <Card className="p-5">
                  <SearchView
                    caseId={params.caseId}
                    onSelectArtifact={(artifactId) => {
                      setFocusArtifactId(artifactId);
                      setView("timeline");
                    }}
                  />
                </Card>
              )}
              {/* Lays out its own panels plus a right-hand rail, so no
                  outer Card — it would be a box around a box. */}
              {view === "alerts" && (
                <AlertsView
                  caseId={params.caseId}
                  onSelectArtifact={(artifactId) => {
                    setFocusArtifactId(artifactId);
                    setView("timeline");
                  }}
                  onSummary={({ open }) => setOpenAlerts(open)}
                  onOpenReport={() => {
                    setFocusArtifactId(null);
                    setView("report");
                  }}
                />
              )}
              {view === "audit" && (
                <Card className="p-5">
                  <AuditView
                    caseId={params.caseId}
                    onSelectArtifact={(artifactId) => {
                      setFocusArtifactId(artifactId);
                      setView("timeline");
                    }}
                  />
                </Card>
              )}
              {view === "report" && (
                <Card className="p-5">
                  <ReportView
                    caseId={params.caseId}
                    onSelectArtifact={(artifactId) => {
                      setFocusArtifactId(artifactId);
                      setView("timeline");
                    }}
                  />
                </Card>
              )}
              {view === "triage" && (
                <Card className="p-5">
                  <TriageView
                    caseId={params.caseId}
                    onSelectArtifact={(artifactId) => {
                      setFocusArtifactId(artifactId);
                      setView("timeline");
                    }}
                  />
                </Card>
              )}
              {view === "ml" && (
                <Card className="p-5">
                  <MLAnalysisView
                    caseId={params.caseId}
                    onSelectArtifact={(artifactId) => {
                      setFocusArtifactId(artifactId);
                      setView("timeline");
                    }}
                  />
                </Card>
              )}
            </>
          )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `useSearchParams` makes the client tree up to the nearest Suspense
 * boundary client-rendered, and Next errors during prerender without one.
 * The fallback is deliberately the same "Loading case…" line the inner
 * component shows before its fetch resolves, so the boundary is invisible.
 */
export default function CaseDetailPage() {
  return (
    <Suspense
      fallback={<p className="p-6 text-[13px] text-label-secondary">Loading case…</p>}
    >
      <CaseDetail />
    </Suspense>
  );
}

/**
 * The views a case has, defined once.
 *
 * Three places need this list — the sidebar, the tab bar above the case,
 * and the breadcrumb — and they need to agree about what exists and what
 * each view is called. When the list lived in the page component the
 * sidebar had to hardcode its own copy, which is how a nav item ends up
 * pointing at a view that no longer exists.
 *
 * Two label fields on purpose. The sidebar has room for the full name and
 * is read cold ("Evidence search", "AI triage"); the tab bar sits under a
 * case that is already open, where the short form reads better and fits.
 * Same view, two contexts, one definition.
 */
export type CaseView =
  | "people"
  | "timeline"
  | "graph"
  | "search"
  | "alerts"
  | "triage"
  | "ml"
  | "report"
  | "audit";

export type CaseViewDef = {
  value: CaseView;
  /** Short form, used by the tab bar and the breadcrumb. */
  tabLabel: string;
  /** Full form, used by the sidebar. */
  navLabel: string;
};

/** Sidebar order: the investigative sequence — what happened, who was
 * involved, then what the system made of it. */
export const CASE_VIEWS: CaseViewDef[] = [
  { value: "timeline", tabLabel: "Timeline", navLabel: "Timeline" },
  { value: "graph", tabLabel: "Graph", navLabel: "Entity graph" },
  { value: "people", tabLabel: "People", navLabel: "Persons of interest" },
  { value: "search", tabLabel: "Search", navLabel: "Evidence search" },
  { value: "triage", tabLabel: "Triage", navLabel: "AI triage" },
  { value: "ml", tabLabel: "ML", navLabel: "ML analysis" },
  { value: "alerts", tabLabel: "Alerts", navLabel: "Alerts" },
  { value: "report", tabLabel: "Reports", navLabel: "Reports" },
  { value: "audit", tabLabel: "Audit", navLabel: "Audit log" },
];

/**
 * The three views that stay in the tab bar above the case.
 *
 * These are the ones an investigator moves *between* while reading a
 * single case — the same evidence seen three ways, so switching is a
 * glance rather than a navigation. Everything else (search, triage,
 * alerts, reports, the audit log) is its own destination and is reached
 * from the sidebar, which is where the rest of the console's navigation
 * already lives.
 */
export const TAB_VIEWS: CaseView[] = ["people", "timeline", "graph"];

export const DEFAULT_CASE_VIEW: CaseView = "timeline";

const VALUES = new Set<string>(CASE_VIEWS.map((v) => v.value));

/** Guards the `?view=` query param — an unknown or absent value falls
 * back to the default rather than rendering nothing. */
export function isCaseView(value: string | null | undefined): value is CaseView {
  return typeof value === "string" && VALUES.has(value);
}

export function caseViewLabel(value: CaseView): string {
  return CASE_VIEWS.find((v) => v.value === value)?.tabLabel ?? "Case";
}

/** The canonical URL for a view of a case. The `view` param is what makes
 * the sidebar able to link straight to a tab, and what makes a case view
 * shareable and survivable across a reload. */
export function caseViewHref(caseId: string, view: CaseView): string {
  return `/cases/${caseId}?view=${view}`;
}

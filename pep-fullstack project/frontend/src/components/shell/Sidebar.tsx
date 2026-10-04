"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  BrainCircuit,
  ChartColumn,
  ClipboardList,
  Database,
  FileText,
  FolderClosed,
  LayoutGrid,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Waypoints,
} from "lucide-react";
import {
  CASE_VIEWS,
  DEFAULT_CASE_VIEW,
  caseViewHref,
  isCaseView,
  type CaseView,
} from "@/lib/caseViews";

/**
 * Navigation. The case sections are real links now: each one targets the
 * open case's `?view=` URL, so the sidebar and the tab bar drive the same
 * state and either can be used to get anywhere.
 *
 * When no case is open there is nothing for those links to point at — a
 * case view without a case is a 404 waiting to happen. Rather than guess a
 * case (the most recent one is not necessarily the one you want) they
 * render disabled with "Open a case", which is the same honesty the greyed
 * "Not built" items used to carry, for a reason that is now temporary
 * rather than permanent.
 */
type NavItem = {
  label: string;
  href?: string;
  Icon: typeof LayoutGrid;
  /** Why this isn't a link, when it isn't one. */
  note?: string;
};

const PRIMARY: NavItem[] = [
  { label: "Dashboard", href: "/", Icon: LayoutGrid },
  { label: "Cases", href: "/cases", Icon: FolderClosed },
];

/** Icon per case view. Kept here rather than in `lib/caseViews` so that
 * module stays free of UI imports — the page and the breadcrumb use it
 * too, and neither needs lucide. */
const VIEW_ICONS: Record<CaseView, typeof LayoutGrid> = {
  timeline: ClipboardList,
  graph: Waypoints,
  people: Users,
  search: Database,
  triage: Sparkles,
  ml: BrainCircuit,
  alerts: Bell,
  report: FileText,
  audit: ScrollText,
};

/** The trained models behind "ML analysis": how they score on the
 * benchmark, and the data they were built from. Global, not per case. */
const MACHINE_LEARNING: NavItem[] = [
  { label: "Model performance", href: "/models", Icon: ChartColumn },
  { label: "Datasets & statistics", href: "/datasets", Icon: Database },
];

const SYSTEM: NavItem[] = [{ label: "Settings", href: "/settings", Icon: Settings }];

/** The case id from `/cases/<id>`, or null when we're not inside a case.
 * `/cases` and `/cases/new` deliberately don't count — neither has views
 * to link to. */
function caseIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/cases\/([^/]+)/);
  if (!match) return null;
  const id = match[1];
  return id === "new" ? null : id;
}

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-separator bg-surface">
      <div className="flex items-center gap-2.5 px-4 py-4">
        {/* The mark already carries its own shield/colour, unlike the
         * lucide placeholder it replaced -- no background square needed. */}
        <img
          src="/logo.png"
          alt="ACPIA"
          width={36}
          height={36}
          className="size-9 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight text-label-primary">ACPIA</p>
          <p className="truncate text-[11px] text-label-tertiary">Investigation Console</p>
        </div>
      </div>

      {/* Reading the active view needs useSearchParams, which pulls the
          tree up to the nearest boundary into client rendering. Scoping
          the boundary to the nav keeps the rest of the shell prerendered. */}
      <Suspense fallback={<NavSkeleton />}>
        <SidebarNav />
      </Suspense>

      <div className="border-t border-separator px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-accent-green" />
          <p className="text-[11px] text-label-secondary">Synthetic case data only</p>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-label-tertiary">
          No real evidence is processed by this build.
        </p>
      </div>
    </aside>
  );
}

function NavSkeleton() {
  return <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-hidden />;
}

function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const caseId = caseIdFromPath(pathname);
  const viewParam = searchParams.get("view");
  const activeView: CaseView = isCaseView(viewParam) ? viewParam : DEFAULT_CASE_VIEW;

  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-3">
      <Group>
        {PRIMARY.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={
              item.href === "/"
                ? pathname === "/"
                : !!item.href && pathname.startsWith(item.href)
            }
          />
        ))}
      </Group>

      <GroupLabel>Case intelligence</GroupLabel>
      <Group>
        {CASE_VIEWS.map((view) => (
          <NavLink
            key={view.value}
            item={{
              label: view.navLabel,
              Icon: VIEW_ICONS[view.value],
              href: caseId ? caseViewHref(caseId, view.value) : undefined,
              note: caseId ? undefined : "Open a case",
            }}
            // Only highlight while actually inside a case — otherwise the
            // default view would appear selected on the dashboard.
            active={caseId !== null && activeView === view.value}
          />
        ))}
      </Group>

      <GroupLabel>Machine learning</GroupLabel>
      <Group>
        {MACHINE_LEARNING.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={!!item.href && pathname.startsWith(item.href)}
          />
        ))}
      </Group>

      <GroupLabel>System</GroupLabel>
      <Group>
        {SYSTEM.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={!!item.href && pathname.startsWith(item.href)}
          />
        ))}
      </Group>
    </nav>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[10px] font-medium tracking-wide text-label-tertiary">
      {children}
    </p>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { label, href, Icon, note } = item;

  const base =
    "flex items-center gap-2.5 rounded-control px-3 py-2 text-[13px] transition-colors";

  if (!href) {
    return (
      <div
        className={`${base} cursor-default text-label-tertiary`}
        title={note ? `${label} — ${note}` : label}
      >
        <Icon className="size-4 shrink-0 opacity-50" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {note && (
          <span className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[9px] text-label-tertiary">
            {note}
          </span>
        )}
      </div>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${
        active
          ? "bg-accent-blue text-white"
          : "text-label-secondary hover:bg-canvas hover:text-label-primary"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

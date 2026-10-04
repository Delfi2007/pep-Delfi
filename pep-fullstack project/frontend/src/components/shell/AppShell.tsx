import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { Sidebar } from "@/components/shell/Sidebar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * Persistent chrome: sidebar on the left, a slim bar holding only the
 * controls that make sense on every page. Page titles are rendered by
 * the pages themselves, since each one knows its own subject.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-end gap-3 border-b border-separator bg-surface px-6 py-2.5">
          <ThemeToggle />
          <Link
            href="/cases/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-blue px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-blue/90"
          >
            <Plus className="size-3.5" />
            New Case
          </Link>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {children}
          {/* Standing reminder of what this console is and isn't. It says
              "authorised use" and "logged" because both are now true:
              every state change goes to the per-case audit log. It stops
              short of claiming the log survives a restart — it doesn't,
              and the Audit tab says so. */}
          <footer className="flex items-center justify-center gap-2 border-t border-separator px-6 py-3 text-[11px] text-label-tertiary">
            <Lock className="size-3" />
            ACPIA is for authorised use only. State changes are recorded in the case
            audit log.
          </footer>
        </main>
      </div>
    </div>
  );
}

import type { CaseStatus } from "@/lib/types";

const styles: Record<CaseStatus, string> = {
  open: "bg-accent-blue/10 text-accent-blue",
  under_review: "bg-accent-amber/10 text-accent-amber",
  closed: "bg-label-tertiary/15 text-label-secondary",
};

const labels: Record<CaseStatus, string> = {
  open: "Open",
  under_review: "Under review",
  closed: "Closed",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

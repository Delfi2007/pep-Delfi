import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-separator bg-surface ${className}`}
      style={{ boxShadow: "var(--shadow-panel)" }}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** iOS-style grouped-list row with a trailing chevron. Use inside a Card
 * wrapped in `divide-y divide-separator` so rows share hairline dividers. */
export function ListRow({
  href,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  href?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] text-label-primary">{title}</p>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-label-secondary">
            {subtitle}
          </p>
        )}
      </div>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-label-tertiary" />
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block transition-colors hover:bg-canvas active:bg-canvas"
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left transition-colors hover:bg-canvas active:bg-canvas"
    >
      {content}
    </button>
  );
}

"use client";

/**
 * Underline tabs for switching between a case's views.
 *
 * Replaces the pill SegmentedControl here specifically because the case
 * views outgrew it: eight options in a pill group either squeeze the
 * labels or push the row off the side. Underline tabs sit on a rule, wrap
 * cleanly, and read as "sections of this record" rather than "pick one
 * setting" — which is what these are. The SegmentedControl is still the
 * right control where there are two or three mutually exclusive choices
 * (the Connections People/Platforms switch, the theme toggle), so both
 * idioms stay, each doing the job it's good at.
 */
export function TabBar<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="tablist"
      aria-label="Case views"
      className="flex flex-wrap items-center gap-x-1 border-b border-separator"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              active
                ? "border-accent-blue text-accent-blue"
                : "border-transparent text-label-secondary hover:text-label-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

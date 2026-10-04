/** Pill-shaped segmented control for switching between views (e.g. Timeline / Graph). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full bg-canvas p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 ${
            value === opt.value
              ? "bg-surface text-label-primary shadow-sm"
              : "text-label-secondary hover:text-label-primary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

import { platformFromSource, type Platform } from "@/lib/platforms";

/**
 * A platform's mark plus its name. Sized to sit on an iOS-style list row
 * without crowding it — the logo is an identifier, not decoration, so it
 * stays small and never competes with the message text beside it.
 */
export function PlatformBadge({
  platform,
  size = 14,
  showLabel = true,
  className = "",
}: {
  platform: Platform;
  size?: number;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {platform.logo ? (
        <img
          src={platform.logo}
          alt=""
          aria-hidden
          width={size}
          height={size}
          className="shrink-0 rounded-[3px] object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: size / 3, height: size / 3, background: platform.tint }}
        />
      )}
      {showLabel && <span>{platform.label}</span>}
    </span>
  );
}

export function PlatformBadgeForSource({
  source,
  ...rest
}: { source: string } & Omit<Parameters<typeof PlatformBadge>[0], "platform">) {
  return <PlatformBadge platform={platformFromSource(source)} {...rest} />;
}

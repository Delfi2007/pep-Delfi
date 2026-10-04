import type { Artifact } from "@/lib/types";

/**
 * Platform identity in one place, so the timeline, the graph and the
 * event detail panel can't disagree about what "Instagram" looks like.
 *
 * WhatsApp and Instagram get their real marks because an investigator
 * scanning a mixed timeline recognises them faster than any label — that
 * is the whole point of the cross-channel story this case tells. The
 * other sources are first-party artefacts of the device, not third-party
 * platforms, so they stay as typographic labels rather than borrowed
 * iconography.
 */
export type PlatformId = "whatsapp" | "instagram" | "call_log" | "browser" | "images";

export type Platform = {
  id: PlatformId;
  label: string;
  /** Path under /public, or null for sources with no brand mark. */
  logo: string | null;
  /** Brand colour, used sparingly — a hairline or a dot, never a fill. */
  tint: string;
};

export const PLATFORMS: Record<PlatformId, Platform> = {
  whatsapp: { id: "whatsapp", label: "WhatsApp", logo: "/whatsapp.png", tint: "#25D366" },
  instagram: { id: "instagram", label: "Instagram", logo: "/instagram.png", tint: "#E1306C" },
  call_log: { id: "call_log", label: "Call Log", logo: null, tint: "#8E8E93" },
  browser: { id: "browser", label: "Browser", logo: null, tint: "#8E8E93" },
  images: { id: "images", label: "Images", logo: null, tint: "#8E8E93" },
};

/** Maps a source filename (or an actor's channel string) to a platform. */
export function platformFromSource(source: string): Platform {
  const s = source.toLowerCase();
  if (s.includes("whatsapp")) return PLATFORMS.whatsapp;
  if (s.includes("instagram")) return PLATFORMS.instagram;
  if (s.includes("call_log")) return PLATFORMS.call_log;
  if (s.includes("browser_history")) return PLATFORMS.browser;
  return PLATFORMS.images;
}

export function platformForArtifact(artifact: Artifact): Platform {
  if (artifact.type === "image") return PLATFORMS.images;
  return platformFromSource(artifact.source);
}

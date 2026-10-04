import type { Artifact } from "@/lib/types";

export type ContentMap = Record<string, Record<string, unknown>>;

export function previewFor(artifact: Artifact, content: ContentMap): string {
  const c = content[artifact.content_ref];
  if (!c) return "";

  switch (artifact.type) {
    case "message":
      return typeof c.text === "string" ? c.text : "";
    case "call": {
      const duration = typeof c.duration_seconds === "number" ? c.duration_seconds : 0;
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      return `Call · ${mins}m ${secs}s · ${c.from} → ${c.to}`;
    }
    case "browser_history":
      return typeof c.title === "string" ? c.title : String(c.url ?? "");
    case "image":
      return typeof c.filename === "string" ? c.filename : "";
    default:
      return "";
  }
}

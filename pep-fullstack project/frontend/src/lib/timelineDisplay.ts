import type { Artifact, ResolvedActor } from "@/lib/types";
import type { ActorIndex } from "@/lib/actorColors";
import type { ContentMap } from "@/lib/artifactPreview";

export function platformLabel(artifact: Artifact): string {
  if (artifact.source.includes("whatsapp")) return "WhatsApp";
  if (artifact.source.includes("instagram")) return "Instagram";
  if (artifact.source.includes("call_log")) return "Call Log";
  if (artifact.source.includes("browser_history")) return "Browser";
  if (artifact.type === "image") return "Images";
  return artifact.source;
}

export function categoryLabel(artifact: Artifact): string {
  switch (artifact.type) {
    case "message":
      return "Chat";
    case "call":
      return "Call";
    case "image":
      return "Media";
    case "browser_history":
      return "System";
  }
}

/** Resolves who sent/received a given artifact, where that distinction
 * applies (messages, calls). Falls back to a single "owner" for
 * artifacts that don't have a two-party structure (images, browser
 * history rows). */
export function senderRecipient(
  artifact: Artifact,
  content: ContentMap,
  actorIndex: ActorIndex,
): { from: ResolvedActor | null; to: ResolvedActor | null } {
  const c = content[artifact.content_ref];

  if (artifact.type === "message" && c && typeof c.sender === "string") {
    const from = actorIndex.resolve(c.sender) ?? null;
    const to =
      artifact.actors
        .map((id) => actorIndex.resolve(id))
        .find((a) => a && a.actor_id !== from?.actor_id) ?? null;
    return { from, to };
  }

  if (artifact.type === "call" && c && typeof c.from === "string" && typeof c.to === "string") {
    return { from: actorIndex.resolve(c.from) ?? null, to: actorIndex.resolve(c.to) ?? null };
  }

  const owner = artifact.actors[0] ? (actorIndex.resolve(artifact.actors[0]) ?? null) : null;
  return { from: owner, to: null };
}

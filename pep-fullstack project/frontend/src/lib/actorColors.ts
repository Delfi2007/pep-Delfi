import type { ResolvedActor } from "@/lib/types";

// System blue / amber / red are reserved (interactive / flagged / high-risk
// per the design spec) -- actor coloring uses the rest of the iOS tag
// palette so it never competes with those meanings.
const ACTOR_PALETTE = [
  "#5856D6", // indigo
  "#AF52DE", // purple
  "#34C759", // green
  "#00C7BE", // teal
  "#FF2D55", // pink
  "#A2845E", // brown
  "#32ADE6", // cyan
  "#8E8E93", // gray
];

export type ActorIndex = {
  resolve(identifier: string): ResolvedActor | undefined;
  color(identifier: string): string;
};

export function buildActorIndex(identities: ResolvedActor[]): ActorIndex {
  const byIdentifier = new Map<string, ResolvedActor>();
  const colorByActorId = new Map<string, string>();

  // Belt and braces alongside `getJson`: callers should never hand this an
  // error body, but a colour lookup is the last place that should be able
  // to take the whole page down if one ever does.
  const actors = Array.isArray(identities) ? identities : [];

  actors.forEach((actor, i) => {
    colorByActorId.set(actor.actor_id, ACTOR_PALETTE[i % ACTOR_PALETTE.length]);
    for (const id of actor.identifiers) byIdentifier.set(id, actor);
  });

  return {
    resolve(identifier: string) {
      return byIdentifier.get(identifier);
    },
    color(identifier: string) {
      const actor = byIdentifier.get(identifier);
      return actor ? (colorByActorId.get(actor.actor_id) ?? "#8E8E93") : "#8E8E93";
    },
  };
}

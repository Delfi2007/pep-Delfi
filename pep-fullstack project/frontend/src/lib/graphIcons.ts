import type { ActorKind } from "@/lib/types";

/**
 * Raw lucide icon path data (24x24, stroke-based), kept as plain SVG
 * markup strings rather than lucide-react components -- the graph's
 * nodes are rendered by D3 directly into the DOM, outside React's
 * render tree, so components aren't the natural fit here. Injected via
 * `.html()` into a small <g> per node, scaled to fit inside the node's
 * circle. This is the actual point of the icon system: a phone number,
 * a WhatsApp/Instagram handle, a group chat, and a resolved person read
 * as different *shapes* at a glance, not just different label text.
 */
const ICON_PATHS: Record<ActorKind, string> = {
  person: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  phone: `<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>`,
  group: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  handle: `<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>`,
};

export const KIND_LABELS: Record<ActorKind, string> = {
  person: "Person",
  phone: "Phone Number",
  group: "Group Chat",
  handle: "Social Handle",
};

/**
 * Colour per entity kind — categorical encoding, not decoration. Shape
 * (the icon) and colour now carry the same information, which is
 * deliberate: it stays readable at small sizes, in both themes, and for
 * the ~8% of men with a colour vision deficiency, for whom the icon
 * still disambiguates.
 *
 * Kept as CSS variables so both the D3 layer (which writes attributes
 * directly, outside React) and the Tailwind-styled legend and detail
 * panel resolve to exactly the same value.
 */
export const KIND_COLORS: Record<ActorKind, string> = {
  person: "var(--accent-blue)",
  phone: "var(--accent-green)",
  group: "var(--accent-purple)",
  handle: "var(--accent-indigo)",
};

export function kindColor(kind: ActorKind): string {
  return KIND_COLORS[kind] ?? KIND_COLORS.person;
}

export function iconMarkup(kind: ActorKind): string {
  return ICON_PATHS[kind] ?? ICON_PATHS.person;
}

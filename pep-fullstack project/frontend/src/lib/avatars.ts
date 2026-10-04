const AVATAR_COLORS = [
  "#5856D6", "#AF52DE", "#34C759", "#00C7BE",
  "#FF2D55", "#A2845E", "#32ADE6", "#FF9500",
  "#FF3B30", "#5AC8FA", "#007AFF", "#8E8E93",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function avatarUrl(name: string, size = 80): string {
  const seed = hashCode(name);
  return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(name)}_${seed}`;
}

export function avatarColor(name: string): string {
  return AVATAR_COLORS[hashCode(name) % AVATAR_COLORS.length];
}

export function avatarInitial(name: string): string {
  const cleaned = name.replace(/^[@+]/, "");
  return cleaned.charAt(0).toUpperCase();
}

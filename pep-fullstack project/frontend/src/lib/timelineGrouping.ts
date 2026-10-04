export function formatDayHeader(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatTime(iso: string): string {
  return iso.slice(11, 16); // HH:MM straight from the UTC ISO string -- no
  // silent local-time conversion. The whole point of this timeline is
  // being explicit about what's known vs. assumed about time; converting
  // to the viewer's browser timezone would quietly add one more
  // unstated assumption on top of the ones the schema already tracks.
}

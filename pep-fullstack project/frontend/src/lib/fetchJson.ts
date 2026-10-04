/** A fetch that fails loudly instead of handing an error body downstream.
 *
 * The bug this exists to kill: `fetch(...).then(r => r.json())` on a case
 * ID that doesn't exist resolves happily with `{"detail": "Case not
 * found"}`, which then reaches `buildActorIndex` and gets `.forEach`'d as
 * if it were an array — a render crash, from a 404. Auto-seeding makes
 * that *more* likely, not less: the demo case gets a fresh ID on every
 * backend restart, so a tab left open on the old URL hits exactly this.
 *
 * Throwing here routes the failure into the error state each view already
 * renders, so a stale URL degrades to "Failed to load timeline" instead of
 * a blank screen with a stack trace in the console.
 */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    // The backend's 404 body is `{"detail": "..."}`; surface that when it's
    // there, since "Case not found" is more useful than "HTTP 404".
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON error body — the status is all we have.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

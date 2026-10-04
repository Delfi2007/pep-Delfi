const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/alerts/[alertId]/ack">,
) {
  const { caseId, alertId } = await ctx.params;
  // Alert IDs are rule-scoped and contain colons (e.g.
  // "message_to_call:a_0426:a_0472"), so they must be re-encoded rather
  // than pasted into the upstream path raw.
  const { search } = new URL(request.url);
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/alerts/${encodeURIComponent(alertId)}/ack${search}`,
    { method: "POST", cache: "no-store" },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

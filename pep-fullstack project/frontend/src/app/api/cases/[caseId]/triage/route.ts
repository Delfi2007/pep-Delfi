const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/triage">,
) {
  const { caseId } = await ctx.params;
  // `refresh=1` forces a fresh agent run instead of the cached result.
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/triage${refresh ? "?refresh=true" : ""}`,
    { method: "POST", cache: "no-store" },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

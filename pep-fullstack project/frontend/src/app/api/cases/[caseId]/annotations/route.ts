const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/annotations">,
) {
  const { caseId } = await ctx.params;
  const backendResponse = await fetch(`${BACKEND_URL}/cases/${caseId}/annotations`, {
    cache: "no-store",
  });
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

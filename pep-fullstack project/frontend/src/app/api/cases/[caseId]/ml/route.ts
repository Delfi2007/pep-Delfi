const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/ml">,
) {
  const { caseId } = await ctx.params;
  // Forward the query string wholesale so new ML options never need an edit here.
  const { search } = new URL(request.url);
  const backendResponse = await fetch(`${BACKEND_URL}/cases/${caseId}/ml${search}`, {
    cache: "no-store",
  });
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

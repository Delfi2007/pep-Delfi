const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/stages">,
) {
  const { caseId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const url = `${BACKEND_URL}/cases/${caseId}/stages${qs ? `?${qs}` : ""}`;
  const backendResponse = await fetch(url, { cache: "no-store" });
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

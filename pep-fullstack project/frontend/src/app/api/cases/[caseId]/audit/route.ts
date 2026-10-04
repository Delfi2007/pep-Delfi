const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/audit">,
) {
  const { caseId } = await ctx.params;
  const { search } = new URL(request.url);
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/audit${search}`,
    { cache: "no-store" },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

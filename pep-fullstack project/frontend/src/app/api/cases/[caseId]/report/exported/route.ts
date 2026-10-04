const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/report/exported">,
) {
  const { caseId } = await ctx.params;
  const { search } = new URL(request.url);
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/report/exported${search}`,
    { method: "POST", cache: "no-store" },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

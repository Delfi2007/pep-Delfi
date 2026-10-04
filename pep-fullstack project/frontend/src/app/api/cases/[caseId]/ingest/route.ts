const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/ingest">,
) {
  const { caseId } = await ctx.params;
  const formData = await request.formData();

  const backendResponse = await fetch(`${BACKEND_URL}/cases/${caseId}/ingest`, {
    method: "POST",
    body: formData,
  });

  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

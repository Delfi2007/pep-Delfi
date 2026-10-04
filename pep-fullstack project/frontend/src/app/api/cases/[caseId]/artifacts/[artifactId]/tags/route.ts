const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/artifacts/[artifactId]/tags">,
) {
  const { caseId, artifactId } = await ctx.params;
  const body = await request.text();
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/artifacts/${artifactId}/tags`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
  );
  const responseBody = await backendResponse.text();
  return new Response(responseBody, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

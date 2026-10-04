const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/artifacts/[artifactId]/notes">,
) {
  const { caseId, artifactId } = await ctx.params;
  const body = await request.text();
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/artifacts/${artifactId}/notes`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body },
  );
  const responseBody = await backendResponse.text();
  return new Response(responseBody, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

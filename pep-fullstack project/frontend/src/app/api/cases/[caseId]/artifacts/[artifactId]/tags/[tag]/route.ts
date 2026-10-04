const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/artifacts/[artifactId]/tags/[tag]">,
) {
  const { caseId, artifactId, tag } = await ctx.params;
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/artifacts/${artifactId}/tags/${encodeURIComponent(tag)}`,
    { method: "DELETE" },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

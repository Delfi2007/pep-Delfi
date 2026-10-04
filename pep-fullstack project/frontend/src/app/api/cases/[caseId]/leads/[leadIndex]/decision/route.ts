const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/cases/[caseId]/leads/[leadIndex]/decision">,
) {
  const { caseId, leadIndex } = await ctx.params;
  const backendResponse = await fetch(
    `${BACKEND_URL}/cases/${caseId}/leads/${leadIndex}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    },
  );
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

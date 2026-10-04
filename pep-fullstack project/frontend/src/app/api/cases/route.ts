/**
 * Proxies case listing/creation to the FastAPI backend.
 * Per ACPIA_Plan.md §1: Browser -> Next.js API routes (proxy) -> FastAPI.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET() {
  const backendResponse = await fetch(`${BACKEND_URL}/cases`, {
    cache: "no-store",
  });
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  const backendResponse = await fetch(`${BACKEND_URL}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody = await backendResponse.text();
  return new Response(responseBody, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

import { proxyEngineGet, proxyEngineMutation } from "@/lib/engine/proxy";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const { search } = new URL(request.url);
  return proxyEngineGet(`/runs/${encodeURIComponent(id)}/messages${search}`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const normalized =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? { text: (body as { message: string }).message }
      : body;
  return proxyEngineMutation(`/runs/${encodeURIComponent(id)}/messages`, normalized);
}

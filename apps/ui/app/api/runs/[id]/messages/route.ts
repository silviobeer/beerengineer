import { proxyEngineGet, proxyEngineMutation, readProxyMutationBody } from "@/lib/engine/proxy";

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
  const payload = await readProxyMutationBody(request);
  if (!payload.ok) return payload.response;
  const body = payload.body ?? {};
  const normalized =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? { text: (body as { message: string }).message }
      : body;
  return proxyEngineMutation(request, `/runs/${encodeURIComponent(id)}/messages`, normalized);
}

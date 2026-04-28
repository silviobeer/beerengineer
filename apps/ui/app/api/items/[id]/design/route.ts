import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return proxyEngineGet(`/items/${encodeURIComponent(id)}/design`);
}

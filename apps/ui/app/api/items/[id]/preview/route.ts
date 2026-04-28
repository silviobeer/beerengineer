import { proxyEngineGet } from "@/lib/engineProxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  return proxyEngineGet(`/items/${encodeURIComponent(id)}/preview`);
}

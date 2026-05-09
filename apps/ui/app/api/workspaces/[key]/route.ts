import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await context.params;
  return proxyEngineGet(`/workspaces/${encodeURIComponent(key)}`);
}

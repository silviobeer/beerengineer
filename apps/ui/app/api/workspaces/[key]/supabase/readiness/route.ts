import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  const { search } = new URL(request.url);
  return proxyEngineGet(`/workspaces/${encodeURIComponent(key)}/supabase/readiness${search}`);
}

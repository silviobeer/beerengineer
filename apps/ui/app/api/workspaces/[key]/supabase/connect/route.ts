import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  const body = await request.json().catch(() => ({}));
  return proxyEngineMutation(`/workspaces/${encodeURIComponent(key)}/supabase/connect`, body);
}

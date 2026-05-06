import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  return proxyEngineMutation(`/workspaces/${encodeURIComponent(key)}/supabase/branch`, {});
}

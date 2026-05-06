import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  return proxyEngineMutation(request, `/workspaces/${encodeURIComponent(key)}/supabase/branch`);
}

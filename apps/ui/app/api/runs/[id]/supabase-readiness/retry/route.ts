import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return proxyEngineMutation(request, `/runs/${encodeURIComponent(id)}/supabase-readiness/retry`);
}

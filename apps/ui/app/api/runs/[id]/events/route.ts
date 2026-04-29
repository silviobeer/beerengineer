import { proxyEngineStream } from "@/lib/engine/proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const { search } = new URL(request.url);
  return proxyEngineStream(`/runs/${encodeURIComponent(id)}/events${search}`);
}

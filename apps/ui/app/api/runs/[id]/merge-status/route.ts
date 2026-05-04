import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(_req: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return proxyEngineGet(`/runs/${encodeURIComponent(id)}/merge-status`);
}

import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; path: string[] }> }
): Promise<Response> {
  const { id, path } = await context.params;
  const artifactPath = path.map(encodeURIComponent).join("/");
  return proxyEngineGet(`/runs/${encodeURIComponent(id)}/artifacts/${artifactPath}`);
}

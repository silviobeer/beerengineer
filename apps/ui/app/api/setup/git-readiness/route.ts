import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(request: Request): Promise<Response> {
  const { search } = new URL(request.url);
  return proxyEngineGet(`/setup/git-readiness${search}`);
}

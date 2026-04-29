import { proxyEngineStream } from "@/lib/engine/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { search } = new URL(request.url);
  return proxyEngineStream(`/events${search}`);
}

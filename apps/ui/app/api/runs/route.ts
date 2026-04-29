import { proxyEngineGet } from "@/lib/engine/proxy";

export async function GET(): Promise<Response> {
  return proxyEngineGet("/runs");
}

import { proxyEngineGet, proxyEnginePatch } from "@/lib/engine/proxy";

export async function GET(): Promise<Response> {
  return proxyEngineGet("/setup/config");
}

export async function PATCH(request: Request): Promise<Response> {
  return proxyEnginePatch(request, "/setup/config");
}

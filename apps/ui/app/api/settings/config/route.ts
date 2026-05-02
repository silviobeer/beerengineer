import { proxyEngineGet, proxyEnginePatch } from "@/lib/engine/proxy";

export async function GET(): Promise<Response> {
  return proxyEngineGet("/setup/config");
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxyEnginePatch("/setup/config", body);
}

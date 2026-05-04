import { proxyEnginePatch } from "@/lib/engine/proxy";

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxyEnginePatch("/setup/supabase/settings", body);
}

import { proxyEnginePatch } from "@/lib/engine/proxy";

export async function PATCH(request: Request): Promise<Response> {
  return proxyEnginePatch(request, "/setup/supabase/settings");
}

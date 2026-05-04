import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  let body: { workspaceId?: unknown; token?: unknown; projectRef?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  return proxyEngineMutation("/setup/supabase/connect", body);
}

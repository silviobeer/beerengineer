import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxyEngineMutation("/setup/supabase/rotate", body);
}

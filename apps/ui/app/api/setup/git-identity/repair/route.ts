import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON" }, { status: 400 });
  }
  return proxyEngineMutation("/setup/git-identity/repair", body);
}

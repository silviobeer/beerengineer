import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  let body: { ref?: unknown; action?: unknown; value?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) return Response.json({ error: "invalid_secret_ref" }, { status: 400 });
  return proxyEngineMutation(`/setup/secrets/${encodeURIComponent(ref)}`, {
    action: body.action,
    value: body.value,
  });
}

import { proxyEngineMutation, readProxyMutationBody } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  const payload = await readProxyMutationBody(request);
  if (!payload.ok) return payload.response;
  const body = (payload.body ?? {}) as { ref?: unknown; action?: unknown; value?: unknown };
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) return Response.json({ error: "invalid_secret_ref" }, { status: 400 });
  return proxyEngineMutation(request, `/setup/secrets/${encodeURIComponent(ref)}`, {
    action: body.action,
    value: body.value,
  });
}

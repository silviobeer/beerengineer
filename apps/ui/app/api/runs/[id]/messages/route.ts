import { proxyEngineMutation } from "@/lib/engineProxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const normalized =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? { text: (body as { message: string }).message }
      : body;
  return proxyEngineMutation(`/runs/${encodeURIComponent(id)}/messages`, normalized);
}

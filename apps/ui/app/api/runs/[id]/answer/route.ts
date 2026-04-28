import { proxyEngineMutation } from "@/lib/engine/proxy";

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
  return proxyEngineMutation(`/runs/${encodeURIComponent(id)}/answer`, body);
}

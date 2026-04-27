import { proxyEngineMutation } from "@/lib/engineProxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> }
): Promise<Response> {
  const { id, action } = await context.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxyEngineMutation(
    `/items/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
    body
  );
}

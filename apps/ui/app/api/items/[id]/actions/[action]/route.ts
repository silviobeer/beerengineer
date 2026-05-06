import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> }
): Promise<Response> {
  const { id, action } = await context.params;
  return proxyEngineMutation(
    request,
    `/items/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`
  );
}

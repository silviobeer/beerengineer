import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(request: Request): Promise<Response> {
  return proxyEngineMutation(request, "/items/import-prepared");
}

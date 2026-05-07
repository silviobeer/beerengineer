import { proxyEngineGet, proxyEngineMutation } from "@/lib/engine/proxy";

export async function GET(): Promise<Response> {
  return proxyEngineGet("/runs");
}

export async function POST(request: Request): Promise<Response> {
  return proxyEngineMutation(request, "/runs");
}

import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(): Promise<Response> {
  return proxyEngineMutation("/setup/init", {});
}

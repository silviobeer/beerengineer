import { NextRequest } from "next/server";
import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyEngineMutation("/setup/supabase/destroy", body);
}

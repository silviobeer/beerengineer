import { NextRequest } from "next/server";
import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(req: NextRequest) {
  return proxyEngineMutation(req, "/setup/supabase/recreate");
}

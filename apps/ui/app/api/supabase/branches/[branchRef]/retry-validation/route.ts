import { NextRequest } from "next/server";
import { proxyEngineMutation } from "@/lib/engine/proxy";

export async function POST(req: NextRequest, { params }: Readonly<{ params: Promise<{ branchRef: string }> }>) {
  const { branchRef } = await params;
  const body = await req.json().catch(() => ({}));
  return proxyEngineMutation(`/supabase/branches/${encodeURIComponent(branchRef)}/retry-validation`, body);
}

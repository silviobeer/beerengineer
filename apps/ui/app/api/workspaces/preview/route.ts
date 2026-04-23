import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")
  const qs = path ? `?path=${encodeURIComponent(path)}` : ""
  const res = await forwardToEngine(`/workspaces/preview${qs}`)
  return NextResponse.json(await res.json(), { status: res.status })
}

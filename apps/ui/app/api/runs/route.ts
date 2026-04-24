import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function POST(req: NextRequest) {
  const body = await req.text()
  const res = await forwardToEngine("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await ctx.params
  const body = await req.text()
  const res = await forwardToEngine(`/items/${id}/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

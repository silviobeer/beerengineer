import { NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function POST(_req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params
  const res = await forwardToEngine(`/notifications/test/${encodeURIComponent(channel)}`, {
    method: "POST",
  })
  const body = await res.json().catch(() => ({}))
  return NextResponse.json(body, { status: res.status })
}

import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel")
  const limit = req.nextUrl.searchParams.get("limit")
  const qs = new URLSearchParams()
  if (channel) qs.set("channel", channel)
  if (limit) qs.set("limit", limit)
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  const res = await forwardToEngine(`/notifications/deliveries${suffix}`)
  const body = await res.json().catch(() => ({}))
  return NextResponse.json(body, { status: res.status })
}

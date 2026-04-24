import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await forwardToEngine(`/runs/${id}/messages${req.nextUrl.search}`)
  return NextResponse.json(await res.json(), { status: res.status })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.text()
  const res = await forwardToEngine(`/runs/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

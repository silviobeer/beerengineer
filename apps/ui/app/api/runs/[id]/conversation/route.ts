import { NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await forwardToEngine(`/runs/${id}/conversation`)
  return NextResponse.json(await res.json(), { status: res.status })
}

import { NextRequest } from "next/server"
import { forwardToEngine, proxyEngineResponse } from "@/app/api/_lib/engine"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await forwardToEngine(`/runs/${id}/events${req.nextUrl.search}`)
  return proxyEngineResponse(res)
}

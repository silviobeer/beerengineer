import { forwardToEngine, proxyEngineResponse } from "@/app/api/_lib/engine"

export const dynamic = "force-dynamic"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await forwardToEngine(`/runs/${id}/events`)
  return proxyEngineResponse(res)
}

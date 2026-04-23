import { NextRequest } from "next/server"
import { forwardToEngine, proxyEngineResponse } from "@/app/api/_lib/engine"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search
  const res = await forwardToEngine(`/events${search}`)
  return proxyEngineResponse(res)
}

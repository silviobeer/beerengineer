import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"
import { runCliItemAction } from "@/app/api/_lib/cli"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  if (body.action === "start_brainstorm" || body.action === "start_implementation") {
    const result = await runCliItemAction({ itemRef: id, action: body.action })
    if (result.ok) {
      return NextResponse.json(
        { itemId: id, runId: result.runId, column: body.action === "start_brainstorm" ? "brainstorm" : "implementation", phaseStatus: "running" },
        { status: 200 }
      )
    }
    return NextResponse.json({ error: result.error, action: body.action }, { status: result.status >= 400 ? result.status : 409 })
  }
  const res = await forwardToEngine(`/items/${id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

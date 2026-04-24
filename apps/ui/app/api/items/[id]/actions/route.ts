import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"
import { runCliItemAction, runCliResume } from "@/app/api/_lib/cli"

type ActionBody = {
  action?: string
  resume?: {
    summary?: string
    branch?: string
    commit?: string
    reviewNotes?: string
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as ActionBody

  // start-run actions: spawn the CLI. Workflows never run in the engine
  // HTTP process.
  if (body.action === "start_brainstorm" || body.action === "start_implementation") {
    const result = await runCliItemAction({ itemRef: id, action: body.action })
    if (result.ok) {
      return NextResponse.json(
        {
          itemId: id,
          runId: result.runId,
          column: body.action === "start_brainstorm" ? "brainstorm" : "implementation",
          phaseStatus: "running",
        },
        { status: 200 },
      )
    }
    return NextResponse.json(
      { error: result.error, action: body.action },
      { status: result.status >= 400 ? result.status : 409 },
    )
  }

  // resume_run: also spawn the CLI. The engine never calls performResume.
  if (body.action === "resume_run") {
    const summary = body.resume?.summary?.trim()
    if (!summary) {
      return NextResponse.json({ error: "remediation_required", action: body.action }, { status: 422 })
    }
    const result = await runCliResume({
      itemRef: id,
      summary,
      branch: body.resume?.branch?.trim() || undefined,
      commit: body.resume?.commit?.trim() || undefined,
      reviewNotes: body.resume?.reviewNotes?.trim() || undefined,
    })
    if (result.ok) {
      return NextResponse.json({ itemId: id, runId: result.runId, resumed: true }, { status: 200 })
    }
    return NextResponse.json(
      { error: result.error, action: body.action },
      { status: result.status >= 400 ? result.status : 409 },
    )
  }

  // Pure state transitions (promote_to_requirements, mark_done) are DB-only
  // updates — forward to the engine HTTP server.
  const res = await forwardToEngine(`/items/${id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

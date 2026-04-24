import { NextRequest, NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"
import { runCliResume } from "@/app/api/_lib/cli"

/**
 * Resume a blocked run. Always spawns the CLI to re-enter the workflow —
 * the engine HTTP process never runs workflows. We fetch the run row via
 * the engine HTTP API to resolve the itemId, then spawn
 * `beerengineer item-action --action resume_run ...` which records the
 * remediation and calls performResume synchronously in its own process.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as {
    summary?: string
    branch?: string
    commit?: string
    reviewNotes?: string
  }

  if (!body.summary?.trim()) {
    return NextResponse.json({ error: "remediation_required" }, { status: 422 })
  }

  const runRes = await forwardToEngine(`/runs/${id}`)
  if (!runRes.ok) {
    return NextResponse.json(await runRes.json().catch(() => ({ error: "run_not_found" })), { status: runRes.status })
  }
  const run = (await runRes.json()) as { item_id?: string }
  if (!run.item_id) {
    return NextResponse.json({ error: "run_missing_item" }, { status: 500 })
  }

  const result = await runCliResume({
    itemRef: run.item_id,
    summary: body.summary.trim(),
    branch: body.branch?.trim() || undefined,
    commit: body.commit?.trim() || undefined,
    reviewNotes: body.reviewNotes?.trim() || undefined,
  })
  if (result.ok) {
    return NextResponse.json({ runId: result.runId, resumed: true }, { status: 200 })
  }
  return NextResponse.json(
    { error: result.error },
    { status: result.status >= 400 ? result.status : 500 },
  )
}

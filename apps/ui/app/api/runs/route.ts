import { NextRequest, NextResponse } from "next/server"
import { startCliWorkflow } from "../_lib/cli"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    description?: string
    workspaceKey?: string
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 })
  }

  const result = await startCliWorkflow({
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    workspaceKey: body.workspaceKey?.trim() || undefined,
  })
  if ("runId" in result) {
    return NextResponse.json({ runId: result.runId }, { status: 202 })
  }
  return NextResponse.json({ error: result.error }, { status: result.status && result.status >= 400 ? result.status : 500 })
}

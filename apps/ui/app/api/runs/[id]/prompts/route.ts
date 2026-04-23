import { NextResponse } from "next/server"
import { forwardToEngine } from "@/app/api/_lib/engine"
import { resolvePromptDisplayText } from "@/app/api/_lib/promptDisplay"

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const res = await forwardToEngine(`/runs/${id}/prompts`)
  const body = (await res.json()) as {
    prompt: { id: string; run_id: string; prompt: string } | null
  }
  const prompt = body.prompt
    ? {
        ...body.prompt,
        displayPrompt: resolvePromptDisplayText(id, body.prompt.prompt),
      }
    : null
  return NextResponse.json({ prompt }, { status: res.status })
}

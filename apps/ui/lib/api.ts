export const ENGINE_BASE_URL = process.env.NEXT_PUBLIC_ENGINE_BASE_URL ?? "http://127.0.0.1:4100"

export type RunRow = {
  id: string
  workspace_id: string
  item_id: string
  title: string
  status: string
  current_stage: string | null
  created_at: number
  updated_at: number
}

export type StageRunRow = {
  id: string
  run_id: string
  stage_key: string
  status: string
  started_at: number | null
  completed_at: number | null
  error_message: string | null
}

export type PendingPromptRow = {
  id: string
  run_id: string
  prompt: string
  answer: string | null
  created_at: number
  answered_at: number | null
}

export async function listRuns(): Promise<RunRow[]> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs`, { cache: "no-store" })
  if (!res.ok) return []
  const body = (await res.json()) as { runs: RunRow[] }
  return body.runs
}

export async function startRun(input: {
  title: string
  description: string
  workspaceKey?: string
}): Promise<{ runId: string } | { error: string }> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
  return (await res.json()) as { runId: string } | { error: string }
}

export async function answerPrompt(runId: string, promptId: string, answer: string): Promise<void> {
  await fetch(`${ENGINE_BASE_URL}/runs/${runId}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ promptId, answer })
  })
}

export async function getOpenPrompt(runId: string): Promise<PendingPromptRow | null> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs/${runId}/prompts`, { cache: "no-store" })
  if (!res.ok) return null
  const body = (await res.json()) as { prompt: PendingPromptRow | null }
  return body.prompt ?? null
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs/${runId}`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as RunRow
}

export async function getRunTree(runId: string): Promise<{ run: RunRow; stageRuns: StageRunRow[] } | null> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs/${runId}/tree`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as { run: RunRow; stageRuns: StageRunRow[] }
}

export type ItemAction =
  | "start_brainstorm"
  | "promote_to_requirements"
  | "start_implementation"
  | "resume_run"
  | "mark_done"

export type ItemActionResponse =
  | { ok: true; itemId: string; runId?: string; column: string; phaseStatus: string }
  | { ok: false; status: number; error: string; current?: { column: string; phaseStatus: string }; action?: string }

export async function performItemAction(itemId: string, action: ItemAction): Promise<ItemActionResponse> {
  const res = await fetch(`${ENGINE_BASE_URL}/items/${itemId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok) {
    return { ok: true, ...(body as { itemId: string; runId?: string; column: string; phaseStatus: string }) }
  }
  return {
    ok: false,
    status: res.status,
    error: (body as { error?: string }).error ?? `http_${res.status}`,
    current: (body as { current?: { column: string; phaseStatus: string } }).current,
    action: (body as { action?: string }).action
  }
}

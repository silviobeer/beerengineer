import type { IncomingMessage, ServerResponse } from "node:http"
import type { Db } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import { getBoard, getRunTree } from "../board.js"
import { isResumeInFlight } from "../../core/resume.js"
import { buildConversation, recordAnswer, recordUserMessage } from "../../core/conversation.js"
import { messagingLevelFromQuery, shouldDeliverAtLevel } from "../../core/messagingLevel.js"
import { projectStageLogRow } from "../../core/messagingProjection.js"
import { resumeRunInProcess, startRunFromIdea } from "../../core/runService.js"
import { json, readJson } from "../http.js"

export function handleGetBoard(db: Db, url: URL, res: ServerResponse): void {
  const workspaceKey = url.searchParams.get("workspace")
  const board = getBoard(db, workspaceKey)
  json(res, 200, board)
}

export function handleGetRun(repos: Repos, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found", code: "not_found" })
  const conv = buildConversation(repos, runId)
  json(res, 200, { ...run, openPrompt: conv?.openPrompt ?? null })
}

export function handleGetRunTree(repos: Repos, res: ServerResponse, runId: string): void {
  const tree = getRunTree(repos, runId)
  if (!tree) return json(res, 404, { error: "run not found", code: "not_found" })
  json(res, 200, tree)
}

export function handleListRuns(repos: Repos, res: ServerResponse): void {
  json(res, 200, { runs: repos.listRuns() })
}

export function handleGetConversation(repos: Repos, res: ServerResponse, runId: string): void {
  const conversation = buildConversation(repos, runId)
  if (!conversation) return json(res, 404, { error: "run not found", code: "not_found" })
  json(res, 200, conversation)
}

export function handleGetMessages(repos: Repos, url: URL, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found", code: "not_found" })

  const level = messagingLevelFromQuery(url.searchParams.get("level"), 2)
  const since = url.searchParams.get("since")
  const rawLimit = Number(url.searchParams.get("limit") ?? 200)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 200

  const entries = []
  let cursor = since
  while (entries.length < limit) {
    const batch = repos.listLogsForRunAfterId(runId, cursor, limit * 4)
    if (batch.length === 0) break
    for (const row of batch) {
      const entry = projectStageLogRow(row)
      if (entry && shouldDeliverAtLevel(entry, level)) entries.push(entry)
      cursor = row.id
      if (entries.length >= limit) break
    }
    if (batch.length < limit * 4) break
  }

  json(res, 200, {
    runId,
    schema: "messages-v1",
    nextSince: entries.length === limit ? entries[entries.length - 1]?.id ?? null : null,
    entries,
  })
}

export async function handlePostMessage(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const body = (await readJson(req)) as { text?: string; source?: string }
  const source = body.source === "cli" || body.source === "webhook" ? body.source : "api"
  const result = recordUserMessage(repos, {
    runId,
    text: typeof body.text === "string" ? body.text : "",
    source,
  })
  if (!result.ok) {
    if (result.code === "empty_message") return json(res, 400, { error: "text is required", code: "bad_request" })
    return json(res, 404, { error: "run not found", code: "not_found" })
  }
  const entry = result.conversation.entries.find(candidate => candidate.id === result.entryId) ?? null
  json(res, 201, { ok: true, entry, conversation: result.conversation })
}

export function handleGetRecovery(repos: Repos, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run_not_found", code: "not_found" })
  if (!run.recovery_status) return json(res, 200, { recovery: null })
  json(res, 200, {
    recovery: {
      status: run.recovery_status,
      scope: run.recovery_scope,
      scopeRef: run.recovery_scope_ref,
      summary: run.recovery_summary,
      resumable: !isResumeInFlight(runId),
      remediations: repos.listExternalRemediations(runId),
    },
  })
}

/**
 * Resume a blocked run. Previously this route recorded the remediation row
 * and returned `needsSpawn: true`; the UI then had to spawn the CLI to
 * re-enter the workflow. Post-refactor the engine HTTP process owns the
 * resume — `resumeRunInProcess` fires the workflow in the background and
 * returns the ids immediately.
 */
export async function handleResumeRun(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const body = (await readJson(req)) as {
    summary?: string
    branch?: string
    commit?: string
    reviewNotes?: string
  }

  const result = await resumeRunInProcess(repos, {
    runId,
    summary: body.summary ?? "",
    branch: body.branch,
    commit: body.commit,
    reviewNotes: body.reviewNotes,
  })
  if (!result.ok) {
    return json(res, result.status, { error: result.error })
  }
  const run = repos.getRun(result.runId)
  json(res, 200, { runId: result.runId, status: run?.status ?? "running" })
}

/** `POST /runs` — start a fresh run from a title/description + optional workspace. */
export async function handleCreateRun(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as {
    title?: string
    description?: string
    workspaceKey?: string
  }
  const title = typeof body.title === "string" ? body.title.trim() : ""
  if (!title) return json(res, 400, { error: "title is required", code: "bad_request" })

  const result = startRunFromIdea(repos, {
    title,
    description: typeof body.description === "string" ? body.description.trim() : "",
    workspaceKey: typeof body.workspaceKey === "string" && body.workspaceKey.trim()
      ? body.workspaceKey.trim()
      : undefined,
  })
  if (!result.ok) return json(res, result.status, { error: result.error })
  const run = repos.getRun(result.runId)
  json(res, 202, {
    runId: result.runId,
    itemId: result.itemId,
    status: run?.status ?? "running",
  })
}

/**
 * Canonical answer endpoint. Write path:
 *   1. Mark `pending_prompts` row as answered.
 *   2. Append `prompt_answered` to `stage_logs` — `attachCrossProcessBridge`
 *      on the workflow's bus picks it up and re-emits locally, resolving
 *      the workflow's pending `bus.request()`.
 *   3. Return the updated conversation snapshot.
 */
export async function handleAnswer(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const body = (await readJson(req)) as { answer?: string; promptId?: string }
  const result = recordAnswer(repos, {
    runId,
    promptId: body.promptId,
    answer: typeof body.answer === "string" ? body.answer : "",
    source: "api",
  })
  if (!result.ok) {
    if (result.code === "empty_answer") return json(res, 400, { error: "answer is required", code: "bad_request" })
    if (result.code === "run_not_found") return json(res, 404, { error: "run not found", code: "not_found" })
    return json(res, 409, { error: "prompt_not_open", code: "prompt_not_open" })
  }
  json(res, 200, result.conversation)
}

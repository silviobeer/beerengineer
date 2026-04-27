import type { IncomingMessage, ServerResponse } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, resolve as resolvePath, sep } from "node:path"
import type { Db } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import { getBoard, getRunTree } from "../board.js"
import { isResumeInFlight } from "../../core/resume.js"
import { buildConversation, recordAnswer, recordUserMessage } from "../../core/conversation.js"
import { MESSAGES_ENDPOINT_MAX_SCAN } from "../../core/constants.js"
import { messagingLevelFromQuery, shouldDeliverAtLevel } from "../../core/messagingLevel.js"
import { projectStageLogRow } from "../../core/messagingProjection.js"
import { resumeRunInProcess, startRunFromIdea } from "../../core/runService.js"
import { json, readJson } from "../http.js"
import { layout } from "../../core/workspaceLayout.js"
import { resolveWorkflowContextForRun } from "../../core/workflowContextResolver.js"

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".md":
      return "text/markdown; charset=utf-8"
    default:
      return "text/plain; charset=utf-8"
  }
}

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

export function handleGetArtifacts(repos: Repos, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found", code: "not_found" })
  json(res, 200, { runId, artifacts: repos.listArtifactsForRun(runId) })
}

export async function handleGetArtifactFile(
  repos: Repos,
  res: ServerResponse,
  runId: string,
  requestedPath: string,
): Promise<void> {
  // Design-prep user-revise iterations derive the on-disk run directory as
  // `<baseRunId>-rev<N>` while the DB still only stores `<baseRunId>`. Accept
  // the revise-suffixed form by looking up the base run row but keeping the
  // derived runId for the disk path.
  const revMatch = runId.match(/^(.+)-rev(\d+)$/)
  const lookupId = revMatch ? revMatch[1] : runId
  const run = repos.getRun(lookupId)
  if (!run) return json(res, 404, { error: "run not found", code: "not_found" })
  // Decode once — the regex in the router yields the raw URL segment, which
  // may still contain percent-escapes (e.g. %2e for "." inside a segment).
  let decoded: string
  try {
    decoded = decodeURIComponent(requestedPath)
  } catch {
    return json(res, 400, { error: "invalid_path", code: "bad_request" })
  }
  if (decoded.includes("\0")) return json(res, 400, { error: "invalid_path", code: "bad_request" })
  const ctx = resolveWorkflowContextForRun(repos, run, { runIdOverride: runId })
  if (!ctx) return json(res, 404, { error: "artifact root unreachable", code: "not_found" })
  const base = resolvePath(layout.runDir(ctx))
  const full = resolvePath(base, decoded)
  if (full !== base && !full.startsWith(base + sep)) {
    return json(res, 400, { error: "invalid_path", code: "bad_request" })
  }
  try {
    const info = await stat(full)
    if (!info.isFile()) return json(res, 404, { error: "artifact not found", code: "not_found" })
  } catch {
    return json(res, 404, { error: "artifact not found", code: "not_found" })
  }
  const body = await readFile(full)
  // Artifact files are written by the engine but rendered from LLM output. Prevent
  // MIME sniffing and disable script execution if the browser ever loads them.
  res.writeHead(200, {
    "content-type": contentTypeFor(full),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:;",
  })
  res.end(body)
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
  let scanned = 0
  let hitScanCap = false
  outer: while (entries.length < limit) {
    const batch = repos.listLogsForRunAfterId(runId, cursor, limit * 4)
    if (batch.length === 0) break
    for (const row of batch) {
      const entry = projectStageLogRow(row)
      if (entry && shouldDeliverAtLevel(entry, level)) entries.push(entry)
      cursor = row.id
      scanned += 1
      if (entries.length >= limit) break outer
      if (scanned >= MESSAGES_ENDPOINT_MAX_SCAN) {
        hitScanCap = true
        break outer
      }
    }
    if (batch.length < limit * 4) break
  }

  const nextSince =
    entries.length === limit
      ? entries[entries.length - 1]?.id ?? null
      : hitScanCap
      ? cursor
      : null

  json(res, 200, {
    runId,
    schema: "messages-v1",
    nextSince,
    entries,
  })
}

export async function handlePostMessage(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const body = (await readJson(req)) as { text?: string }
  // External callers can't spoof source — the HTTP boundary pins it to "api".
  // Internal surfaces (CLI, webhook handler) call `recordUserMessage` directly
  // and set their own source.
  const result = recordUserMessage(repos, {
    runId,
    text: typeof body.text === "string" ? body.text : "",
    source: "api",
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

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Db } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import { getBoard, getRunTree } from "../board.js"
import { isResumeInFlight, loadResumeReadiness } from "../../core/resume.js"
import { json, readJson } from "../http.js"

export function handleGetBoard(db: Db, url: URL, res: ServerResponse): void {
  const workspaceKey = url.searchParams.get("workspace")
  const board = getBoard(db, workspaceKey)
  json(res, 200, board)
}

export function handleGetRun(repos: Repos, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found" })
  json(res, 200, run)
}

export function handleGetRunTree(repos: Repos, res: ServerResponse, runId: string): void {
  const tree = getRunTree(repos, runId)
  if (!tree) return json(res, 404, { error: "run not found" })
  json(res, 200, tree)
}

export function handleListRuns(repos: Repos, res: ServerResponse): void {
  json(res, 200, { runs: repos.listRuns() })
}

export function handleGetRunPrompts(repos: Repos, res: ServerResponse, runId: string): void {
  const open = repos.getOpenPrompt(runId)
  json(res, 200, { prompt: open ?? null })
}

export function handleGetRecovery(repos: Repos, res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run_not_found" })
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
 * Record the remediation row and return `needsSpawn: true`. The engine HTTP
 * server never calls `performResume` — the UI layer is responsible for
 * spawning the CLI to actually re-enter the workflow.
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

  const readiness = await loadResumeReadiness(repos, runId)
  if (readiness.kind === "not_found") return json(res, 404, { error: "run_not_found" })
  if (readiness.kind === "no_recovery") {
    return json(res, 409, { error: "not_resumable", recovery: null })
  }
  if (readiness.kind === "not_resumable") {
    return json(res, 409, { error: readiness.reason, recovery: readiness.record ?? null })
  }
  if (!body.summary || body.summary.trim().length === 0) {
    return json(res, 422, { error: "remediation_required" })
  }
  if (isResumeInFlight(runId)) {
    return json(res, 409, { error: "resume_in_progress", recovery: readiness.record })
  }

  const scopeRef =
    readiness.record.scope.type === "stage"
      ? readiness.record.scope.stageId
      : readiness.record.scope.type === "story"
      ? `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
      : null
  const remediation = repos.createExternalRemediation({
    runId,
    scope: readiness.record.scope.type,
    scopeRef,
    summary: body.summary,
    branch: body.branch,
    commitSha: body.commit,
    reviewNotes: body.reviewNotes,
    source: "api",
  })

  json(res, 200, { runId, remediationId: remediation.id, needsSpawn: true })
}

/**
 * All runs live in the CLI process. UI-side prompt answers are written into
 * the shared transport (pending_prompts row + prompt_answered log). The
 * CLI's `attachCrossProcessBridge` tails that log and re-emits the event
 * onto its local bus, resolving the pending `ask()`.
 */
export async function handleRunInput(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  const body = (await readJson(req)) as { answer?: string; promptId?: string }
  if (!body.answer) return json(res, 400, { error: "answer is required" })

  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found" })

  const promptId = body.promptId ?? repos.getOpenPrompt(runId)?.id
  if (!promptId) return json(res, 404, { error: "no open prompt" })

  const answered = repos.answerPendingPrompt(promptId, body.answer)
  if (!answered) return json(res, 404, { error: "prompt not pending" })

  repos.appendLog({
    runId,
    eventType: "prompt_answered",
    message: body.answer,
    data: { promptId, source: "api" },
  })

  json(res, 200, { runId, promptId, answer: body.answer })
}

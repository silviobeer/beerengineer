/**
 * Orphan recovery — called once at API startup before `server.listen`.
 *
 * When the Node process hosting the HTTP server crashes or is restarted, any
 * `owner='api'` run with `status='running'` is left with no live worker
 * because the API server *was* the worker. This module finds those and
 * marks them `status='failed'` with a resume-compatible recovery projection
 * so that `POST /runs/:id/resume` accepts them without a manual DB patch.
 *
 * `owner='cli'` runs are *not* killed: the CLI process is independent of
 * the API server, so a server restart says nothing about whether the CLI
 * worker is alive. CLI workers install their own SIGINT/SIGTERM/SIGHUP
 * handlers in `cli/commands/itemActions.ts` to mark their run as failed
 * when the CLI process actually dies.
 *
 * The recovery payload uses `recovery_scope='run'` (run-level scope). The
 * resume path in `loadResumeReadiness` synthesises a minimal RecoveryRecord
 * when no `recovery.json` file exists on disk, so no filesystem write is
 * required here — only the DB columns matter.
 */

import type { Repos, RunRow } from "../db/repositories.js"
import { mapStageToColumn } from "./boardColumns.js"
import type { StartupRecoveryOutcome as StartupRecoveryOutcomeKind, StartupRecoveryReason } from "./io.js"
import { STALE_WORKER_HEARTBEAT_MS } from "./workerLease.js"

export type OrphanRecoveryResult = {
  /** Number of runs that were found orphaned and marked failed. */
  recovered: number
  /** Run ids recovered during this pass, in scan order. */
  recoveredRunIds: string[]
  /** Startup recovery outcome recorded for each processed stale run. */
  outcomes: StartupRecoveryOutcome[]
}

export type StartupRecoveryOutcome = {
  runId: string
  outcome: StartupRecoveryOutcomeKind
  reason: StartupRecoveryReason | null
}

type StartupAutoResumeOptions = {
  enabled: boolean
  resumeRun: (run: RunRow) => Promise<void>
}

const RECOVERY_SUMMARY =
  "API restart lost API worker ownership — no live worker; resume or abandon."
const SHUTDOWN_RECOVERY_SUMMARY =
  "Graceful shutdown stopped the API worker — resume or abandon."

function hasOtherLiveRunForItem(repos: Repos, run: RunRow): boolean {
  return repos
    .listRunsForItem(run.item_id)
    .some(candidate => candidate.id !== run.id && (candidate.status === "running" || candidate.status === "blocked"))
}

function projectRecoveredRunToItem(repos: Repos, run: RunRow): void {
  if (hasOtherLiveRunForItem(repos, run)) return
  const item = repos.getItem(run.item_id)
  if (!item) return
  const mapped = run.current_stage
    ? mapStageToColumn(run.current_stage, "failed")
    : { column: item.current_column, phaseStatus: "failed" as const }
  repos.setItemColumn(item.id, mapped.column, "failed")
  repos.setItemCurrentStage(item.id, null)
}

export function markRunFailedRecoverable(repos: Repos, runId: string, summary: string): void {
  const run = repos.getRun(runId)
  if (!run) return
  repos.updateRun(run.id, {
    status: "failed",
    recovery_status: "failed",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: summary,
  })
  projectRecoveredRunToItem(repos, run)
}

function shouldRecoverLostWorker(
  run: RunRow,
  input: { apiWorkerInstanceId: string; now: number },
): boolean {
  if (run.status !== "running") return false
  const owner = run.worker_owner_kind ?? run.owner
  if (owner === "api") {
    return run.worker_instance_id !== input.apiWorkerInstanceId
  }
  const heartbeatAt = run.worker_heartbeat_at
  return heartbeatAt == null || input.now - heartbeatAt > STALE_WORKER_HEARTBEAT_MS
}

function recoverySummary(run: RunRow): string {
  const owner = run.worker_owner_kind ?? run.owner
  if (owner === "api") return RECOVERY_SUMMARY
  return "CLI worker heartbeat is stale — no live worker; resume or abandon."
}

function startupRecoveryMessage(outcome: StartupRecoveryOutcome, error?: string): string {
  if (outcome.outcome === "auto_resumed") {
    return "Startup recovery auto-resumed the stale run."
  }
  if (outcome.reason === "open_prompt") {
    return "Startup recovery left the stale run on manual recovery because a prompt is still open."
  }
  if (outcome.reason === "auto_resume_disabled") {
    return "Startup recovery left the stale run on manual recovery because auto-resume is disabled."
  }
  return `Startup recovery auto-resume failed; the run remains on manual recovery.${error ? ` ${error}` : ""}`
}

function appendStartupRecoveryLog(
  repos: Repos,
  outcome: StartupRecoveryOutcome,
  error?: string,
): void {
  repos.appendLog({
    runId: outcome.runId,
    eventType: "startup_recovery",
    message: startupRecoveryMessage(outcome, error),
    data: {
      outcome: outcome.outcome,
      reason: outcome.reason,
      ...(error ? { error } : {}),
    },
  })
}

export async function recoverLostWorkerRuns(
  repos: Repos,
  input: { apiWorkerInstanceId: string; now?: number; autoResume?: StartupAutoResumeOptions },
): Promise<OrphanRecoveryResult> {
  const now = input.now ?? Date.now()
  const recoveredRunIds: string[] = []
  const outcomes: StartupRecoveryOutcome[] = []
  for (const run of repos.listRunningRuns()) {
    if (!shouldRecoverLostWorker(run, { apiWorkerInstanceId: input.apiWorkerInstanceId, now })) continue
    markRunFailedRecoverable(repos, run.id, recoverySummary(run))
    recoveredRunIds.push(run.id)
    if (!input.autoResume) continue

    if (repos.getOpenPrompt(run.id)) {
      const outcome = { runId: run.id, outcome: "skipped", reason: "open_prompt" } satisfies StartupRecoveryOutcome
      outcomes.push(outcome)
      appendStartupRecoveryLog(repos, outcome)
      continue
    }
    if (!input.autoResume.enabled) {
      const outcome = { runId: run.id, outcome: "skipped", reason: "auto_resume_disabled" } satisfies StartupRecoveryOutcome
      outcomes.push(outcome)
      appendStartupRecoveryLog(repos, outcome)
      continue
    }

    try {
      await input.autoResume.resumeRun(repos.getRun(run.id) ?? run)
      const outcome = { runId: run.id, outcome: "auto_resumed", reason: null } satisfies StartupRecoveryOutcome
      outcomes.push(outcome)
      appendStartupRecoveryLog(repos, outcome)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const outcome = { runId: run.id, outcome: "failed", reason: "auto_resume_failed" } satisfies StartupRecoveryOutcome
      outcomes.push(outcome)
      appendStartupRecoveryLog(repos, outcome, message)
    }
  }

  if (recoveredRunIds.length > 0) {
    console.warn(
      `[orphanRecovery] ${recoveredRunIds.length} lost worker run(s) marked failed on startup: ${recoveredRunIds.join(", ")}`,
    )
  }

  return { recovered: recoveredRunIds.length, recoveredRunIds, outcomes }
}

export async function recoverApiRunsForShutdown(
  repos: Repos,
  input: { apiWorkerInstanceId: string },
): Promise<OrphanRecoveryResult> {
  const recoveredRunIds: string[] = []
  for (const run of repos.listRunningRuns()) {
    if (run.owner !== "api") continue
    if (run.worker_owner_kind !== "api") continue
    if (run.worker_instance_id !== input.apiWorkerInstanceId) continue
    markRunFailedRecoverable(repos, run.id, SHUTDOWN_RECOVERY_SUMMARY)
    recoveredRunIds.push(run.id)
  }

  if (recoveredRunIds.length > 0) {
    console.warn(
      `[orphanRecovery] ${recoveredRunIds.length} API worker run(s) marked recoverable for graceful shutdown: ${recoveredRunIds.join(", ")}`,
    )
  }

  return { recovered: recoveredRunIds.length, recoveredRunIds, outcomes: [] }
}

/**
 * Scan the DB for all runs with `status='running'`. By definition these are
 * orphaned: a fresh process has no worker tracking them. Mark each one:
 *   - `status='failed'`
 *   - `recovery_status='failed'`
 *   - `recovery_scope='run'`  (run-level — broadest scope; resume re-enters from current_stage)
 *   - `recovery_scope_ref=null`
 *   - `recovery_summary` = a human-readable explanation
 *
 * Emits a single `console.warn` listing orphaned run IDs so the operator can
 * see the recovery at startup without digging into DB or logs.
 */
export async function markOrphanedRunsFailed(repos: Repos): Promise<OrphanRecoveryResult> {
  return recoverLostWorkerRuns(repos, { apiWorkerInstanceId: "current-api-process" })
}

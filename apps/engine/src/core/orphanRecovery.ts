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

import type { Repos } from "../db/repositories.js"

export type OrphanRecoveryResult = {
  /** Number of runs that were found orphaned and marked failed. */
  recovered: number
}

const RECOVERY_SUMMARY =
  "API restart while run was in flight — no live worker; resume or abandon."

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
  const orphaned = repos.listRunningApiOwnedRuns()

  if (orphaned.length === 0) {
    return { recovered: 0 }
  }

  const ids: string[] = []
  for (const run of orphaned) {
    repos.updateRun(run.id, {
      status: "failed",
      recovery_status: "failed",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: RECOVERY_SUMMARY,
    })
    ids.push(run.id)
  }

  console.warn(
    `[orphanRecovery] ${ids.length} orphaned run(s) marked failed on startup: ${ids.join(", ")}`,
  )

  return { recovered: ids.length }
}

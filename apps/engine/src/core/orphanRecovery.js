/**
 * Orphan recovery — called once at API startup before `server.listen`.
 *
 * When the Node process hosting the HTTP server crashes or is restarted, any
 * run with `status='running'` is left with no live worker. These runs can
 * never complete on their own. This module finds them and marks them
 * `status='failed'` with a resume-compatible recovery projection so that
 * `POST /runs/:id/resume` accepts them without a manual DB patch.
 *
 * The recovery payload uses `recovery_scope='run'` (run-level scope). The
 * resume path in `loadResumeReadiness` synthesises a minimal RecoveryRecord
 * when no `recovery.json` file exists on disk, so no filesystem write is
 * required here — only the DB columns matter.
 */
const RECOVERY_SUMMARY = "API restart while run was in flight — no live worker; resume or abandon.";
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
export async function markOrphanedRunsFailed(repos) {
    const orphaned = repos.listRunningRuns();
    if (orphaned.length === 0) {
        return { recovered: 0 };
    }
    const ids = [];
    for (const run of orphaned) {
        repos.updateRun(run.id, {
            status: "failed",
            recovery_status: "failed",
            recovery_scope: "run",
            recovery_scope_ref: null,
            recovery_summary: RECOVERY_SUMMARY,
        });
        ids.push(run.id);
    }
    console.warn(`[orphanRecovery] ${ids.length} orphaned run(s) marked failed on startup: ${ids.join(", ")}`);
    return { recovered: ids.length };
}

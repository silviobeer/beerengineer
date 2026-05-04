import type { Repos } from "../../db/repositories.js"
import type { SupabaseAdapter } from "./types.js"
import { SupabaseDeferredCleanupStore } from "./deferredCleanupStore.js"
import { runDueSupabaseCleanups } from "./cleanupOrchestrator.js"
import type { Db } from "../../db/connection.js"

/**
 * QA-010: at boot — and on a periodic timer thereafter — we must drive the
 * deferred-cleanup queue forward for every Supabase-connected workspace.
 * Without this, branches scheduled with `ttl-after-success` accrue
 * indefinitely after a process restart (the original timer that would have
 * fired them is gone), inflating provider cost.
 *
 * Each workspace is processed inside its own try/catch — a single workspace
 * failure must not crash boot or block the others.
 */

export type CleanupCatchupSummary = {
  workspaceId: string
  workspaceKey: string
  ok: boolean
  processed: number
  error?: string
}

export type CleanupCatchupDeps = {
  repos: Repos
  db: Db
  adapterFor: (workspace: { id: string; supabaseProjectRef: string }) => Pick<SupabaseAdapter, "destroyBranch"> | null
  log?: (event: string, payload: Record<string, unknown>) => void
  now?: () => number
}

export async function runStartupCleanupCatchup(deps: CleanupCatchupDeps): Promise<CleanupCatchupSummary[]> {
  const log = deps.log ?? defaultLog
  const summaries: CleanupCatchupSummary[] = []
  const workspaces = deps.repos.listWorkspacesWithSupabase()
  const store = new SupabaseDeferredCleanupStore(deps.db)
  for (const workspace of workspaces) {
    if (!workspace.supabase_project_ref) continue
    const summary: CleanupCatchupSummary = {
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      ok: true,
      processed: 0,
    }
    try {
      const adapter = deps.adapterFor({ id: workspace.id, supabaseProjectRef: workspace.supabase_project_ref })
      if (!adapter) {
        summary.ok = false
        summary.error = "adapter_unavailable"
        summaries.push(summary)
        log("supabase_cleanup_catchup_skipped", { workspaceKey: workspace.key, reason: "adapter_unavailable" })
        continue
      }
      const results = await runDueSupabaseCleanups({
        repos: deps.repos,
        adapter,
        deferredStore: store,
        workspaceId: workspace.id,
        projectRef: workspace.supabase_project_ref,
        now: deps.now?.(),
      })
      summary.processed = results.length
      log("supabase_cleanup_catchup_ran", { workspaceKey: workspace.key, processed: results.length })
    } catch (err) {
      summary.ok = false
      summary.error = err instanceof Error ? err.message : "unknown_error"
      log("supabase_cleanup_catchup_failed", { workspaceKey: workspace.key, error: summary.error })
    }
    summaries.push(summary)
  }
  return summaries
}

function defaultLog(event: string, payload: Record<string, unknown>): void {
  console.error(`[supabase] ${event}`, payload)
}

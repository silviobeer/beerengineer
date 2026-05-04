import { unlink } from "node:fs/promises"
import type { Repos } from "../../db/repositories.js"
import type { SupabaseAdapter } from "./types.js"
import { SupabaseDeferredCleanupStore } from "./deferredCleanupStore.js"

export type CleanupPolicy = "on-success-immediate" | "ttl-after-success" | "manual"

async function deleteHandoff(path?: string | null): Promise<boolean> {
  if (!path) return false
  try {
    await unlink(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

export async function cleanupSuccessfulBranch(input: {
  repos: Repos
  adapter: Pick<SupabaseAdapter, "destroyBranch">
  deferredStore?: SupabaseDeferredCleanupStore
  workspaceId: string
  projectRef: string
  branchRef: string
  branchName?: string | null
  runId?: string | null
  waveId?: string | null
  lifecycleState?: string | null
  policy: CleanupPolicy
  ttlHours?: number | null
  handoffPath?: string | null
  now?: number
}): Promise<{ ok: boolean; action: "destroyed" | "scheduled" | "retained" | "skipped"; warning?: string; events?: string[]; reason?: string }> {
  if (input.lifecycleState === "retained-for-diagnosis") return { ok: true, action: "skipped", warning: "retained-for-diagnosis is excluded from automatic cleanup" }
  if (input.policy === "manual") {
    if (input.runId) input.repos.setRunSupabaseLifecycleState(input.runId, "retained-pending-cleanup")
    return { ok: true, action: "retained", warning: "Supabase branch retained; provider cost risk remains until manual cleanup" }
  }
  if (input.policy === "ttl-after-success") {
    if (!input.deferredStore) return { ok: false, action: "scheduled", reason: "deferred_store_required" }
    const scheduledAt = (input.now ?? Date.now()) + Math.max(1, input.ttlHours ?? 1) * 3_600_000
    input.deferredStore.schedule({ workspaceId: input.workspaceId, branchRef: input.branchRef, runId: input.runId, waveId: input.waveId, handoffPath: input.handoffPath, scheduledAt })
    if (input.runId) input.repos.setRunSupabaseLifecycleState(input.runId, "retained-pending-cleanup")
    return { ok: true, action: "scheduled" }
  }
  const result = await input.adapter.destroyBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, branchRef: input.branchRef, runId: input.runId ?? undefined })
  if (!result.ok) return { ok: false, action: "retained", reason: String(result.context?.message ?? result.context?.error ?? "destroy_failed") }
  await deleteHandoff(input.handoffPath)
  if (input.runId) input.repos.setRunSupabaseLifecycleState(input.runId, "destroyed")
  return { ok: true, action: "destroyed", events: ["supabase.branch.destroyed"] }
}

export async function explicitDestroyBranch(input: {
  repos: Repos
  adapter: Pick<SupabaseAdapter, "destroyBranch">
  workspaceId: string
  projectRef: string
  branchRef: string
  branchName: string
  confirmedName: string
  runId?: string | null
  handoffPath?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  if (input.confirmedName !== input.branchName) return { ok: false, error: "confirmation_mismatch" }
  const result = await input.adapter.destroyBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, branchRef: input.branchRef, runId: input.runId ?? undefined })
  if (!result.ok) return { ok: false, error: String(result.context?.message ?? result.context?.error ?? "destroy_failed") }
  await deleteHandoff(input.handoffPath)
  if (input.runId) input.repos.setRunSupabaseLifecycleState(input.runId, "destroyed")
  return { ok: true }
}

export async function runDueSupabaseCleanups(input: {
  repos: Repos
  adapter: Pick<SupabaseAdapter, "destroyBranch">
  deferredStore: SupabaseDeferredCleanupStore
  workspaceId: string
  projectRef: string
  now?: number
}): Promise<Array<{ branchRef: string; ok: boolean }>> {
  const due = input.deferredStore.listDue(input.now)
  const results: Array<{ branchRef: string; ok: boolean }> = []
  for (const job of due) {
    if (job.workspace_id !== input.workspaceId) continue
    const result = await cleanupSuccessfulBranch({
      repos: input.repos,
      adapter: input.adapter,
      workspaceId: input.workspaceId,
      projectRef: input.projectRef,
      branchRef: job.branch_ref,
      runId: job.run_id,
      handoffPath: job.handoff_path,
      policy: "on-success-immediate",
    })
    if (result.ok) input.deferredStore.delete(input.workspaceId, job.branch_ref)
    results.push({ branchRef: job.branch_ref, ok: result.ok })
  }
  return results
}

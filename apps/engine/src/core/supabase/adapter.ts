import type { SupabaseAdapter, SupabaseAdapterResult, SupabaseWorkspaceContext } from "./types.js"
import { createOrAttachPersistentTestBranch, type PersistentBranchClient } from "./persistentTestBranch.js"
import type { Repos } from "../../db/repositories.js"
import { ownedWaveBranchPrefix, waveBranchName } from "./branchNaming.js"
import { pollSupabaseBranch, SupabaseBranchPollTimeoutError } from "./branchPoller.js"
import { applySupabaseMigrationsAndSeeds, type SupabaseMigrationClient } from "./migrationRunner.js"
import { migrationSmoke } from "./dbTests/migrationSmoke.js"

export class NotImplementedError extends Error {
  constructor(operation: string) {
    super(`Supabase adapter operation not implemented: ${operation}`)
    this.name = "NotImplementedError"
  }
}

function notImplemented(operation: keyof SupabaseAdapter) {
  return async (_context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> => {
    throw new NotImplementedError(operation)
  }
}

export const defaultSupabaseAdapter: SupabaseAdapter = {
  provisionBranch: notImplemented("provisionBranch"),
  pollBranchStatus: notImplemented("pollBranchStatus"),
  validateBranch: notImplemented("validateBranch"),
  destroyBranch: notImplemented("destroyBranch"),
  migrateProduction: notImplemented("migrateProduction"),
  reconcile: notImplemented("reconcile"),
}

type WaveClient = PersistentBranchClient & SupabaseMigrationClient & {
  getBranch?(projectRef: string, branchRef: string): Promise<{ id: string; ref: string; name?: string; status?: string }>
  deleteBranch?(projectRef: string, branchRef: string): Promise<void>
}

export function createSupabaseAdapter(deps: { repos: Repos; client: WaveClient }): SupabaseAdapter {
  return {
    ...defaultSupabaseAdapter,
    async provisionBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      const workspaceId = context.workspaceId
      if (!workspaceId) return { ok: false, context: { error: "workspace_required" } }
      if (context.waveId) {
        const workspace = deps.repos.getWorkspace(workspaceId)
        if (!workspace || !context.projectRef || !context.parentBranchRef || !context.runId || !context.itemId || !context.projectId) {
          return { ok: false, context: { error: "wave_context_required" } }
        }
        if (context.parentBranchRef === "main" || context.parentBranchRef === "production") {
          return { ok: false, context: { error: "invalid_parent", message: "Wave branches must fork from the persistent test branch" } }
        }
        const name = waveBranchName({
          workspace: context.workspaceKey ?? workspace.key,
          runId: context.runId,
          itemId: context.itemId,
          projectId: context.projectId,
          waveId: context.waveId,
        })
        const branch = await deps.client.createBranch(context.projectRef, { name, parentRef: context.parentBranchRef })
        deps.repos.setRunSupabaseBranch(context.runId, { ref: branch.ref, name, lifecycleState: "provisioning" })
        return { ok: true, context: { branchRef: branch.ref, branchName: name, parentBranchRef: context.parentBranchRef } }
      }
      const result = await createOrAttachPersistentTestBranch({
        repos: deps.repos,
        workspaceId,
        client: deps.client,
        parentRef: context.branchRef,
      })
      return result.ok
        ? { ok: true, context: { action: result.action, branchRef: result.branch.ref, branchName: result.name } }
        : { ok: false, context: { error: result.error, message: result.message } }
    },
    async pollBranchStatus(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.projectRef || !context.branchRef || !deps.client.getBranch) return { ok: false, context: { error: "branch_context_required" } }
      try {
        const branch = await pollSupabaseBranch({ poll: () => deps.client.getBranch!(context.projectRef!, context.branchRef!) })
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "ready")
        return { ok: true, context: { status: "ready", branchRef: branch.ref } }
      } catch (err) {
        const status = err instanceof SupabaseBranchPollTimeoutError ? "timeout" : "failed"
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        return { ok: false, context: { status, reason: err instanceof Error ? err.message : "Supabase branch polling failed" } }
      }
    },
    async validateBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.workspaceRoot || !context.projectRef || !context.branchRef) return { ok: false, context: { error: "validation_context_required" } }
      if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "validating")
      try {
        const records = await applySupabaseMigrationsAndSeeds({
          workspaceRoot: context.workspaceRoot,
          projectRef: context.projectRef,
          branchRef: context.branchRef,
          client: deps.client,
        })
        const smoke = migrationSmoke(records)
        if (!smoke.ok) throw new Error(smoke.reason)
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "validated")
        return { ok: true, context: { status: "validated", applied: records } }
      } catch (err) {
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        return { ok: false, context: { status: "retained-for-diagnosis", failingStep: "migration-seed", message: err instanceof Error ? err.message : "Validation failed" } }
      }
    },
    async destroyBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.projectRef || !context.branchRef || !deps.client.deleteBranch) return { ok: false, context: { error: "destroy_context_required" } }
      try {
        await deps.client.deleteBranch(context.projectRef, context.branchRef)
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "destroyed")
        return { ok: true, context: { status: "destroyed", branchRef: context.branchRef } }
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 404) return { ok: true, context: { status: "destroyed", branchRef: context.branchRef, idempotent: true } }
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        return { ok: false, context: { status: "retained-for-diagnosis", message: err instanceof Error ? err.message : "Destroy failed" } }
      }
    },
    async reconcile(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.workspaceId || !context.workspaceKey || !context.projectRef) return { ok: false, context: { error: "reconcile_context_required" } }
      const branches = await deps.client.listBranches(context.projectRef)
      const prefix = ownedWaveBranchPrefix(context.workspaceKey)
      const runs = deps.repos.listRuns()
      const classifications = branches
        .filter(branch => (branch.name ?? "").startsWith(prefix))
        .map(branch => {
          const run = runs.find(candidate => candidate.supabase_branch_ref === branch.ref || candidate.supabase_branch_name === branch.name)
          const status = branch.status ?? ""
          if (!run || /error|failed/i.test(status)) return { branchRef: branch.ref, branchName: branch.name, classification: "retained-for-diagnosis" }
          if (run.status === "completed") return { branchRef: branch.ref, branchName: branch.name, runId: run.id, classification: "cleanup-candidate" }
          deps.repos.setRunSupabaseBranch(run.id, { ref: branch.ref, name: branch.name ?? branch.ref, lifecycleState: status === "ACTIVE_HEALTHY" ? "ready" : run.supabase_branch_lifecycle_state ?? "provisioning" })
          return { branchRef: branch.ref, branchName: branch.name, runId: run.id, classification: "adoptable" }
        })
      return { ok: true, context: { classifications } }
    },
  }
}

export async function recreatePersistentTestBranch(input: {
  repos: Repos
  adapter: SupabaseAdapter
  workspaceId: string
  projectRef: string
  branchRef: string
  branchName: string
  workspaceRoot: string
}): Promise<SupabaseAdapterResult> {
  const destroyed = await input.adapter.destroyBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, branchRef: input.branchRef })
  if (!destroyed.ok) {
    input.repos.setWorkspaceSupabasePersistentBranch(input.workspaceId, { ref: input.branchRef, name: input.branchName, status: "retained-for-diagnosis" })
    return { ok: false, context: { status: "retained-for-diagnosis", error: "destroy_failed" } }
  }
  const provisioned = await input.adapter.provisionBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, workspaceRoot: input.workspaceRoot, branchRef: input.branchRef })
  if (!provisioned.ok) return { ok: false, context: { status: "failed", error: "recreate_failed" } }
  return { ok: true, context: { status: "ready", branchRef: provisioned.context?.branchRef } }
}

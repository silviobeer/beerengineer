import type { SupabaseAdapter, SupabaseAdapterResult, SupabaseWorkspaceContext } from "./types.js"
import { createOrAttachPersistentTestBranch, type PersistentBranchClient } from "./persistentTestBranch.js"
import type { Repos } from "../../db/repositories.js"

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

export function createSupabaseAdapter(deps: { repos: Repos; client: PersistentBranchClient }): SupabaseAdapter {
  return {
    ...defaultSupabaseAdapter,
    async provisionBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      const workspaceId = context.workspaceId
      if (!workspaceId) return { ok: false, context: { error: "workspace_required" } }
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
  }
}

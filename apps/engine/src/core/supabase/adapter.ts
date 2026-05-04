import type { SupabaseAdapter, SupabaseAdapterResult, SupabaseWorkspaceContext } from "./types.js"

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


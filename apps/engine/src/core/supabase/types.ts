export type SupabaseWorkspaceContext = {
  workspaceId?: string
  workspaceRoot?: string
  projectRef?: string
  branchRef?: string
  waveId?: string
}

export type SupabaseAdapterResult = {
  ok: boolean
  context?: Record<string, unknown>
}

export type SupabaseAdapter = {
  provisionBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
  pollBranchStatus(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
  validateBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
  destroyBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
  migrateProduction(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
  reconcile(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult>
}


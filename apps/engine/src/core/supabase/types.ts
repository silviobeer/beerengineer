export type SupabaseWorkspaceContext = {
  workspaceId?: string
  workspaceRoot?: string
  workspaceKey?: string
  runId?: string
  itemId?: string
  projectId?: string
  projectRef?: string
  dbMode?: SupabaseDbMode
  branchRef?: string
  parentBranchRef?: string
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

export type SupabaseProject = {
  id: string
  ref: string
  name?: string
  region?: string
  plan?: string
  branchingEnabled?: boolean
  branchQuotaLimit?: number
}

export type SupabaseDbMode = "branching" | "direct"

export type SupabaseBranch = {
  id: string
  ref: string
  name?: string
  status?: string
  parentRef?: string
}

export type SupabaseSqlResult = {
  rows?: unknown[]
  rowCount?: number
}

export const SUPABASE_READINESS_SETUP_ACTIONS = [
  "Store management token",
  "Connect Supabase project",
  "Create persistent test branch",
  "Rotate management token",
  "Re-authorize project access",
] as const

export type SupabaseReadinessSetupAction = typeof SUPABASE_READINESS_SETUP_ACTIONS[number]

export type SupabaseReadinessStatus = "ready" | "blocked" | "checking" | "error"

export type SupabaseReadinessRetry = {
  available: boolean
  runId?: string
}

export type SupabaseReadinessWorkspace = {
  id?: string
  key?: string
  rootPath?: string
  projectRef?: string
  dbMode?: SupabaseDbMode
  persistentTestBranchRef?: string
  persistentTestBranchName?: string
}

export type SupabaseReadinessBranch = {
  ref?: string
  status: "active_healthy" | "missing" | "timeout" | "provider_error" | "unauthorized" | "degraded" | "unknown"
  providerStatus?: string
}

export type SupabaseDbRelevanceTrigger = {
  waveId: string
  waveNumber: number
  storyId?: string
}

export type SupabasePreExecutionReadiness = {
  status: SupabaseReadinessStatus
  missingSetupActions: SupabaseReadinessSetupAction[]
  retry: SupabaseReadinessRetry
  workspace: SupabaseReadinessWorkspace
  branch?: SupabaseReadinessBranch
  dbRelevanceTrigger?: SupabaseDbRelevanceTrigger
  message?: string
}

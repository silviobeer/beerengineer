import {
  SUPABASE_READINESS_SETUP_ACTIONS,
  type SupabaseDbRelevanceTrigger,
  type SupabaseReadinessBranch,
  type SupabaseReadinessRetry,
  type SupabaseReadinessSetupAction,
  type SupabaseReadinessStatus,
  type SupabaseReadinessWorkspace,
} from "./types.js"

export type SupabaseReadinessRecoveryPayload = {
  type: "supabase_readiness"
  status: SupabaseReadinessStatus
  missingSetupActions: SupabaseReadinessSetupAction[]
  retry: SupabaseReadinessRetry
  workspace: SupabaseReadinessWorkspace
  branch?: SupabaseReadinessBranch
  dbRelevanceTrigger?: SupabaseDbRelevanceTrigger
  message?: string
}

export type SupabaseReadinessRecoverySource = {
  status: SupabaseReadinessStatus
  missingSetupActions: SupabaseReadinessSetupAction[]
  retry: SupabaseReadinessRetry
  workspace: SupabaseReadinessWorkspace
  branch?: SupabaseReadinessBranch
  dbRelevanceTrigger?: SupabaseDbRelevanceTrigger
  message?: string
}

const setupActions = new Set<string>(SUPABASE_READINESS_SETUP_ACTIONS)

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function booleanOrFalse(value: unknown): boolean {
  return value === true
}

function recoveryStatus(value: unknown): SupabaseReadinessStatus | null {
  return value === "ready" || value === "blocked" || value === "checking" || value === "error" ? value : null
}

function setupActionList(value: unknown): SupabaseReadinessSetupAction[] {
  if (!Array.isArray(value)) return []
  return value.filter((action): action is SupabaseReadinessSetupAction => typeof action === "string" && setupActions.has(action))
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function workspaceValue(value: unknown): SupabaseReadinessWorkspace {
  const row = objectValue(value)
  if (!row) return {}
  return {
    id: stringOrUndefined(row.id),
    key: stringOrUndefined(row.key),
    rootPath: stringOrUndefined(row.rootPath),
    projectRef: stringOrUndefined(row.projectRef),
    persistentTestBranchRef: stringOrUndefined(row.persistentTestBranchRef),
    persistentTestBranchName: stringOrUndefined(row.persistentTestBranchName),
  }
}

function retryValue(value: unknown): SupabaseReadinessRetry {
  const row = objectValue(value)
  if (!row) return { available: false }
  return {
    available: booleanOrFalse(row.available),
    runId: stringOrUndefined(row.runId),
  }
}

function triggerValue(value: unknown): SupabaseDbRelevanceTrigger | undefined {
  const row = objectValue(value)
  if (!row || typeof row.waveId !== "string" || typeof row.waveNumber !== "number") return undefined
  return {
    waveId: row.waveId,
    waveNumber: row.waveNumber,
    storyId: stringOrUndefined(row.storyId),
  }
}

function branchValue(value: unknown): SupabaseReadinessBranch | undefined {
  const row = objectValue(value)
  if (!row || typeof row.status !== "string") return undefined
  const status = row.status
  if (
    status !== "active_healthy" &&
    status !== "missing" &&
    status !== "timeout" &&
    status !== "provider_error" &&
    status !== "unauthorized" &&
    status !== "degraded" &&
    status !== "unknown"
  ) {
    return undefined
  }
  return {
    ref: stringOrUndefined(row.ref),
    status,
    providerStatus: stringOrUndefined(row.providerStatus),
  }
}

export function buildSupabaseReadinessRecoveryPayload(source: SupabaseReadinessRecoverySource): string {
  return JSON.stringify({
    type: "supabase_readiness",
    status: source.status,
    missingSetupActions: source.missingSetupActions,
    retry: source.retry,
    workspace: source.workspace,
    branch: source.branch,
    dbRelevanceTrigger: source.dbRelevanceTrigger,
    message: source.message,
  } satisfies SupabaseReadinessRecoveryPayload)
}

export function parseSupabaseReadinessRecoveryPayload(raw: string | null | undefined): SupabaseReadinessRecoveryPayload | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const row = objectValue(parsed)
  if (!row || row.type !== "supabase_readiness") return null
  const status = recoveryStatus(row.status)
  if (!status) return null
  return {
    type: "supabase_readiness",
    status,
    missingSetupActions: setupActionList(row.missingSetupActions),
    retry: retryValue(row.retry),
    workspace: workspaceValue(row.workspace),
    branch: branchValue(row.branch),
    dbRelevanceTrigger: triggerValue(row.dbRelevanceTrigger),
    message: stringOrUndefined(row.message),
  }
}

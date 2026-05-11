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

export type SupabaseProvisioningFailureStep = "provision" | "poll" | "handoff" | "validate"

export type SupabaseProvisioningGuidanceReason =
  | "ref_conflict"
  | "branch_not_active_healthy"
  | "multiple_name_matches"
  | "wave_mismatch"

export type SupabaseProvisioningRecoveryGuidance = {
  reason: SupabaseProvisioningGuidanceReason
  attachBranchRefs: string[]
}

export type SupabaseProvisioningOperatorAction = "attach" | "discard"

export type SupabaseProvisioningRecoveryPayload = {
  type: "supabase_provisioning"
  runId: string
  workspaceId?: string
  workspaceKey?: string
  projectRef?: string
  waveId: string
  waveNumber: number
  branchRef?: string
  failedStep: SupabaseProvisioningFailureStep
  failureCause: string
  userMessage: string
  guidance?: SupabaseProvisioningRecoveryGuidance
  operatorAction?: SupabaseProvisioningOperatorAction
}

export type SupabaseProvisioningRecoverySource = Omit<SupabaseProvisioningRecoveryPayload, "type">

const setupActions = new Set<string>(SUPABASE_READINESS_SETUP_ACTIONS)

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const values = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
  return Array.from(new Set(values))
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

export function buildSupabaseProvisioningRecoveryPayload(source: SupabaseProvisioningRecoverySource): string {
  return JSON.stringify({
    type: "supabase_provisioning",
    runId: source.runId,
    workspaceId: source.workspaceId,
    workspaceKey: source.workspaceKey,
    projectRef: source.projectRef,
    waveId: source.waveId,
    waveNumber: source.waveNumber,
    branchRef: source.branchRef,
    failedStep: source.failedStep,
    failureCause: source.failureCause,
    userMessage: source.userMessage,
    guidance: source.guidance,
    operatorAction: source.operatorAction,
  } satisfies SupabaseProvisioningRecoveryPayload)
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

function provisioningStep(value: unknown): SupabaseProvisioningFailureStep | null {
  return value === "provision" || value === "poll" || value === "handoff" || value === "validate"
    ? value
    : null
}

function provisioningGuidanceReason(value: unknown): SupabaseProvisioningGuidanceReason | null {
  return value === "ref_conflict"
    || value === "branch_not_active_healthy"
    || value === "multiple_name_matches"
    || value === "wave_mismatch"
    ? value
    : null
}

function provisioningGuidance(value: unknown): SupabaseProvisioningRecoveryGuidance | undefined {
  const row = objectValue(value)
  if (!row) return undefined
  const reason = provisioningGuidanceReason(row.reason)
  if (!reason) return undefined
  return {
    reason,
    attachBranchRefs: stringArray(row.attachBranchRefs),
  }
}

function provisioningOperatorAction(value: unknown): SupabaseProvisioningOperatorAction | undefined {
  return value === "attach" || value === "discard" ? value : undefined
}

export function runResumeCommand(runId: string): string {
  return `beerengineer run resume ${runId} --remediation-summary "<what you fixed>"`
}

export function discardSupabaseBranchCommand(runId: string): string {
  return `beerengineer run discard-supabase-branch ${runId}`
}

export function attachSupabaseBranchCommand(runId: string, branchRef: string): string {
  return `beerengineer run attach-supabase-branch ${runId} --ref ${branchRef}`
}

export function parseSupabaseProvisioningRecoveryPayload(raw: string | null | undefined): SupabaseProvisioningRecoveryPayload | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const row = objectValue(parsed)
  if (!row || row.type !== "supabase_provisioning" || typeof row.runId !== "string" || typeof row.waveId !== "string" || typeof row.waveNumber !== "number") {
    return null
  }
  const failedStep = provisioningStep(row.failedStep)
  const failureCause = stringOrUndefined(row.failureCause)
  const userMessage = stringOrUndefined(row.userMessage)
  if (!failedStep || !failureCause || !userMessage) return null
  return {
    type: "supabase_provisioning",
    runId: row.runId,
    workspaceId: stringOrUndefined(row.workspaceId),
    workspaceKey: stringOrUndefined(row.workspaceKey),
    projectRef: stringOrUndefined(row.projectRef),
    waveId: row.waveId,
    waveNumber: row.waveNumber,
    branchRef: stringOrUndefined(row.branchRef),
    failedStep,
    failureCause,
    userMessage,
    guidance: provisioningGuidance(row.guidance),
    operatorAction: provisioningOperatorAction(row.operatorAction),
  }
}

export function updateSupabaseProvisioningRecoveryPayload(
  raw: string | null | undefined,
  patch: {
    branchRef?: string | null
    guidance?: SupabaseProvisioningRecoveryGuidance | null
    operatorAction?: SupabaseProvisioningOperatorAction | null
  },
): string | null {
  const payload = parseSupabaseProvisioningRecoveryPayload(raw)
  if (!payload) return null
  return buildSupabaseProvisioningRecoveryPayload({
    ...payload,
    branchRef: patch.branchRef === undefined
      ? payload.branchRef
      : (patch.branchRef ?? undefined),
    guidance: patch.guidance === undefined
      ? payload.guidance
      : (patch.guidance ?? undefined),
    operatorAction: patch.operatorAction === undefined
      ? payload.operatorAction
      : (patch.operatorAction ?? undefined),
  })
}

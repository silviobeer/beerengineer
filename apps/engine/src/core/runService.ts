import { cpSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { busToWorkflowIO, createBus, type EventBus } from "./bus.js"
import { appendItemDecision } from "./itemDecisions.js"
import { attachOneShotPromptAnswer } from "./promptAutoAnswer.js"
import { withPromptPersistence } from "./promptPersistence.js"
import { recordAnswer, type AnswerResult, type AnswerSource } from "./conversation.js"
import { buildSupabaseWorkflowHook, prepareRun, type SupabaseAdapterFactory } from "./runOrchestrator.js"
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { generateReplacementPlanFromArtifacts, performExplicitReplan } from "./replan.js"
import { loadResumeReadiness, performResume, type PerformResumeInput } from "./resume.js"
import { getRegisteredWorkspace } from "./workspaces.js"
import { readWorkspaceConfigSync } from "./workspaces/configFile.js"
import { validateExecutionRoleOpenCodeSelection } from "./workspaces/harnessProfiles.js"
import { deriveProjectStartStages, seedPreparedImportArtifacts, type PreparedImportBundle } from "./preparedImport.js"
import { defaultImportContextGenerator, writeImportContextArtifact, type ImportContextGenerator } from "./importContext.js"
import { layout } from "./workspaceLayout.js"
import { requireWorkflowContextForRun, resolveWorkflowContextForItemRun, resolveWorkflowContextForRun } from "./workflowContextResolver.js"
import { isExecutionOwnershipHandoffRun, queueExecutionOwnershipHandoffResume } from "./executionOwnershipHandoff.js"
import type { Repos, ItemRow, RunRow, ExternalRemediationRow, StageRunRow, WorkspaceRow } from "../db/repositories.js"
import type { WorkflowIO } from "./io.js"
import type { WorkflowResumeInput } from "../workflow.js"
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides } from "../setup/config.js"
import { readWorkspaceGitReadiness, type GitCommandOptions, type WorkspaceGitReadiness } from "../setup/gitIdentity.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../setup/secretMetadata.js"
import { readActiveSecretValue } from "../setup/secretStore.js"
import type { AppConfig } from "../setup/types.js"
import type { WorkerLeaseScheduler } from "./workerLease.js"
import { createSupabaseAdapter } from "./supabase/adapter.js"
import { SupabaseManagementClient } from "./supabase/managementClient.js"
import { recordSupabaseLifecycle } from "./supabase/lifecycleEvents.js"
import { updateSupabaseProvisioningRecoveryPayload } from "./supabase/recoveryPayload.js"
import { retainedDiagnosisRecoveryDecision, type RunRecoveryDecision } from "./supabase/recoveryDecision.js"
import { discardSupabaseBranchFromRunRecovery } from "./supabase/runRecoveryActions.js"
import type { SupabaseWorkflowHook } from "./supabase/workflowHook.js"
import { getWorkerAdmissionController, type WorkerAdmissionController } from "./workerAdmission.js"
import { inspectWorkerLease, STALE_WORKER_HEARTBEAT_MS } from "./workerLease.js"


export type { SupabaseAdapterFactory } from "./runOrchestrator.js"

export const API_WORKER_INSTANCE_ID = process.env.BEERENGINEER_API_INSTANCE_ID ?? `api-${randomUUID()}`

/**
 * The engine-side run orchestration service. Hosts workflows inside the engine
 * HTTP process so UIs don't have to spawn the CLI. Also consumed by the CLI
 * for local-mode commands.
 *
 * Design invariants:
 *   - Every run has its own bus + io. No shared state across runs.
 *   - `start()` fires the workflow as a background promise and returns the
 *     runId synchronously to the HTTP caller. The workflow continues in the
 *     same Node process; answers from `POST /runs/:id/answer` reach it via
 *     `attachCrossProcessBridge` (which tails `stage_logs`).
 *   - Errors from the background promise are logged, never rethrown, so the
 *     engine process stays up across failing runs.
 */

export type WorkflowStartGitBlockedResult = {
  ok: false
  status: 404 | 409 | 422
  error: "git_not_installed" | "git_identity_missing" | "workspace_not_found" | "workspace_not_git_repo" | "workspace_path_unavailable"
  code: "workflow_git_blocked"
  message: string
  readiness?: WorkspaceGitReadiness
  repair?: {
    action: "repair_workspace_identity"
    workspaceId: string
    workspaceKey?: string
    appDefaultIdentityAvailable: boolean
  }
  intent: {
    itemId: string
    action: string
  }
}

export type WorkflowCapabilityOwnershipBlockedResult = {
  ok: false
  status: 409
  error: "workflow_capability_blocked"
  code: "workflow_capability_blocked"
  message: string
}

export type WorkflowCapabilityBlockedReason = "incomplete_config" | "blocked_readiness" | "gate_blocked"

export type WorkflowCapabilityBlockedResult = {
  ok: false
  status: 400 | 409 | 503
  error: "workflow_capability_blocked"
  code: "workflow_capability_blocked"
  reason: WorkflowCapabilityBlockedReason
  message: string
}

export type UnsupportedHarnessSelectionResult = {
  ok: false
  status: 409
  error: "unsupported_harness_selection"
  code: "unsupported_harness_selection"
  message: string
  role: string
}

export type StartRunResult =
  | { ok: true; runId: string; itemId: string }
  | UnsupportedHarnessSelectionResult
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

type StartRunFailureResult = Exclude<StartRunResult, { ok: true; runId: string; itemId: string }>

export type PreparedForegroundRunResult =
  | { ok: true; runId: string; itemId: string; start: () => Promise<void> }
  | UnsupportedHarnessSelectionResult
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

export type ResumeRunResult =
  | { ok: true; runId: string; remediationId: string }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "operator_decision_required"
      code: "operator_decision_required"
      message: string
      decision: RunRecoveryDecision
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type RetryRetainedCurrentState = {
  status: RunRow["status"]
  recoveryStatus: RunRow["recovery_status"]
  supabaseBranchLifecycleState: RunRow["supabase_branch_lifecycle_state"]
}

export type RetryRetainedRunResult =
  | { ok: true; runId: string; remediationId: string }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "retry_retained_conflict"
      code: "retry_retained_conflict"
      message: string
      currentState: RetryRetainedCurrentState
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type ClearAndFreshRunResult =
  | { ok: true; runId: string; remediationId: string }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "clear_and_fresh_conflict"
      code: "clear_and_fresh_conflict"
      message: string
      currentState: RetryRetainedCurrentState
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type SkipCurrentStageRejectionReason =
  | "no_current_stage"
  | "current_stage_terminal"
  | "current_stage_skipped"
  | "current_stage_actively_worked"

export type SkipCurrentStageResult =
  | { ok: true; runId: string; status: RunRow["status"]; recoveryStatus: RunRow["recovery_status"] }
  | {
      ok: false
      status: 409
      error: "skip_current_stage_not_allowed"
      code: "skip_current_stage_not_allowed"
      message: string
      reason: SkipCurrentStageRejectionReason
    }
  | { ok: false; status: 404; error: "run_not_found" }

export type ReplanRunResult =
  | { ok: true; runId: string }
  | { ok: false; status: 404; error: "run_not_found"; message: string }
  | { ok: false; status: 409; error: "replan_plan_missing"; message: string }
  | {
      ok: false
      status: 409
      error: "replan_run_active"
      message: string
      currentStatus: RunRow["status"]
      workerHeartbeatAt: string | null
      hint: "Use POST /runs/:runId/block-now to pause, then replan."
    }
  | { ok: false; status: 422; error: "reason_required"; message: string }
  | { ok: false; status: 500; error: string; message: string }

export const RESERVED_RUN_RECOVERY_ACTIONS = [
  "resume",
  "replan",
  "retry_supabase_readiness",
] as const

export const IMPLEMENTED_RUN_RECOVERY_ACTIONS = [
  "skip_current_stage",
  "recover_fresh_branch",
  "retry_retained",
  "clear_and_fresh",
] as const

export const NARROW_RUN_RECOVERY_CLEAR_ACTIONS = [
  "clear_recovery_payload",
  "clear_supabase_branch_ref",
  "clear_supabase_branch_lifecycle_state",
] as const

export type ReservedRunRecoveryAction = (typeof RESERVED_RUN_RECOVERY_ACTIONS)[number]
export type ImplementedRunRecoveryAction = (typeof IMPLEMENTED_RUN_RECOVERY_ACTIONS)[number]
export type NarrowRunRecoveryClearAction = (typeof NARROW_RUN_RECOVERY_CLEAR_ACTIONS)[number]
export type RunRecoveryAction = ReservedRunRecoveryAction | ImplementedRunRecoveryAction | NarrowRunRecoveryClearAction
export type RunRecoveryActionRequest = {
  action?: string
  summary?: string
  branch?: string
  commit?: string
  reviewNotes?: string
  reason?: string
}

type RecoveryLatestState = {
  recoveryPayloadJson: string | null
  supabaseBranchRef: string | null
  supabaseBranchLifecycleState: string | null
}

export const FRESH_PATH_RECOVERY_STATUS = "fresh_path_recovery"
export const RETAINED_PATH_RECOVERY_STATUS = "retained_path_recovery"

export type RecoveryPathStatus =
  | typeof FRESH_PATH_RECOVERY_STATUS
  | typeof RETAINED_PATH_RECOVERY_STATUS

export type SkipCurrentStageEligibilityReason =
  | "no_current_stage"
  | "current_stage_not_active"
  | "current_stage_terminal"
  | "current_stage_already_skipped"
  | "current_stage_worker_active"

export type RunRecoverySurfaceProjection = {
  recoveryStatus: RecoveryPathStatus | null
  supabaseBranchLifecycleState: RecoveryPathStatus | string | null
  availableActions: ImplementedRunRecoveryAction[]
}

type RecoveryClearAcceptedResult = {
  ok: true
  runId: string
  action: NarrowRunRecoveryClearAction
  outcome: "accepted"
  latestState: RecoveryLatestState
}

type RecoveryClearNoopResult = {
  ok: true
  runId: string
  action: NarrowRunRecoveryClearAction
  outcome: "noop"
  reason: "already_clear"
  latestState: RecoveryLatestState
}

type RecoveryNamedAcceptedResult = {
  ok: true
  runId: string
  action: ImplementedRunRecoveryAction
  outcome: "accepted"
  latestState: RecoveryLatestState
  recoveryStatus?: RecoveryPathStatus | "blocked"
  supabaseBranchLifecycleState?: RecoveryPathStatus
  currentStage?: string
  stageStatus?: "skipped"
  runStatus?: "blocked"
}

type RecoveryNamedNoopResult = {
  ok: true
  runId: string
  action: "clear_and_fresh"
  outcome: "noop"
  reason: "already_on_fresh_path"
  latestState: RecoveryLatestState
  recoveryStatus: typeof FRESH_PATH_RECOVERY_STATUS
  supabaseBranchLifecycleState: typeof FRESH_PATH_RECOVERY_STATUS
}

type RecoveryActionRejectedResult =
  | {
      ok: false
      status: 400
      error: "recovery_action_required"
      code: "bad_request"
      reason: "action_required"
      message: string
    }
  | {
      ok: false
      status: 400
      error: "unsupported_recovery_action"
      code: "bad_request"
      action: string
      reason: "unsupported_action"
      message: string
    }
  | {
      ok: false
      status: 400
      error: "recovery_action_invalid_request"
      code: "bad_request"
      action: NarrowRunRecoveryClearAction
      reason: "unexpected_fields"
      message: string
      fields: string[]
    }
  | {
      ok: false
      status: 404
      error: "run_not_found"
      code: "not_found"
      reason: "run_not_found"
      message: string
    }
  | {
      ok: false
      status: 501
      error: "recovery_action_reserved"
      code: "not_implemented"
      action: ReservedRunRecoveryAction
      reason: "action_not_implemented"
      message: string
    }
  | {
      ok: false
      status: 409
      error: "recovery_action_ineligible"
      code: "invalid_transition"
      action: ImplementedRunRecoveryAction
      reason:
        | "incompatible_recovery_state"
        | SkipCurrentStageEligibilityReason
      message: string
    }

export type RunRecoveryActionResult =
  | RecoveryClearAcceptedResult
  | RecoveryClearNoopResult
  | RecoveryNamedAcceptedResult
  | RecoveryNamedNoopResult
  | RecoveryActionRejectedResult

type LoggedRecoveryActionResult =
  | RecoveryClearAcceptedResult
  | RecoveryClearNoopResult
  | RecoveryNamedAcceptedResult
  | RecoveryNamedNoopResult

const ACTIVE_STAGE_RUN_STATUSES = new Set(["pending", "running"])
const TERMINAL_STAGE_RUN_STATUSES = new Set(["completed", "failed", "skipped"])

export type PreparedForegroundResumeRunResult =
  | { ok: true; runId: string; remediationId: string; start: () => Promise<void> }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "operator_decision_required"
      code: "operator_decision_required"
      message: string
      decision: RunRecoveryDecision
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedForegroundRetryRetainedRunResult =
  | { ok: true; runId: string; remediationId: string; start: () => Promise<void> }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "retry_retained_conflict"
      code: "retry_retained_conflict"
      message: string
      currentState: RetryRetainedCurrentState
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedForegroundClearAndFreshRunResult =
  | { ok: true; runId: string; remediationId: string; start: () => Promise<void> }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | {
      ok: false
      status: 409
      error: "clear_and_fresh_conflict"
      code: "clear_and_fresh_conflict"
      message: string
      currentState: RetryRetainedCurrentState
    }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedImportRunResult =
  | { ok: true; runId: string; itemId: string; warnings: string[] }
  | UnsupportedHarnessSelectionResult
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

type PreparedImportFailureResult = Exclude<PreparedImportRunResult, { ok: true; runId: string; itemId: string; warnings: string[] }>

export type PreparedForegroundImportRunResult =
  | { ok: true; runId: string; itemId: string; warnings: string[]; start: () => Promise<void> }
  | UnsupportedHarnessSelectionResult
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

type WorkflowCapabilityBag = {
  supabaseAdapterFactory: SupabaseAdapterFactory | null
}

export type WorkflowCapabilityResolverInput = {
  repos: Repos
  workspace: WorkspaceRow | undefined
  supabaseAdapterFactory?: SupabaseAdapterFactory
}

type WorkflowCapabilityResolution =
  | WorkflowCapabilityBag
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult

export type WorkflowCapabilityResolver = (input: WorkflowCapabilityResolverInput) => WorkflowCapabilityResolution

type WorkflowCapabilityFailureFixture = {
  status?: number
  reason?: unknown
  message?: unknown
  secrets?: unknown
}

function redactCapabilityMessage(value: string, secrets: string[] = []): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[redacted]")
  }
  return redacted
    .replaceAll(/\bsbp_[A-Za-z0-9_-]+\b/g, "sbp_[redacted]")
    .replaceAll(/\bsb_service_role_[A-Za-z0-9._-]+\b/g, "sb_service_role_[redacted]")
    .replaceAll(/\bsk-[A-Za-z0-9._-]+\b/g, "sk-[redacted]")
    .replaceAll(/(?:[A-Za-z]:)?(?:[\\/][^\s"'`]+)+/g, "[redacted-path]")
}

function buildWorkflowCapabilityBlockedResult(input: {
  status: 400 | 409 | 503
  reason: WorkflowCapabilityBlockedReason
  message: string
  secrets?: string[]
}): WorkflowCapabilityBlockedResult {
  return {
    ok: false,
    status: input.status,
    error: "workflow_capability_blocked",
    code: "workflow_capability_blocked",
    reason: input.reason,
    message: redactCapabilityMessage(input.message, input.secrets),
  }
}

function isWorkflowCapabilityBag(result: WorkflowCapabilityResolution): result is WorkflowCapabilityBag {
  return "supabaseAdapterFactory" in result
}

function workflowCapabilityFailureStatus(reason: WorkflowCapabilityBlockedReason, status: number | undefined): 400 | 409 | 503 {
  if (status === 400 || status === 409 || status === 503) return status
  if (reason === "incomplete_config") return 400
  if (reason === "gate_blocked") return 409
  return 503
}

function workflowCapabilityFailureSecrets(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : []
}

function workflowCapabilityFailureMessage(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value
    : "Supabase capability is blocked."
}

function workflowCapabilityFailureFixture(): WorkflowCapabilityBlockedResult | null {
  const raw = process.env.BEERENGINEER_TEST_WORKFLOW_CAPABILITY_FAILURE?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as WorkflowCapabilityFailureFixture
    const reason = parsed.reason
    if (reason !== "incomplete_config" && reason !== "blocked_readiness" && reason !== "gate_blocked") {
      return buildWorkflowCapabilityBlockedResult({
        status: 503,
        reason: "blocked_readiness",
        message: "Supabase capability is blocked by an invalid test fixture.",
      })
    }
    return buildWorkflowCapabilityBlockedResult({
      status: workflowCapabilityFailureStatus(reason, parsed.status),
      reason,
      message: workflowCapabilityFailureMessage(parsed.message),
      secrets: workflowCapabilityFailureSecrets(parsed.secrets),
    })
  } catch {
    return buildWorkflowCapabilityBlockedResult({
      status: 503,
      reason: "blocked_readiness",
      message: "Supabase capability is blocked by an unreadable test fixture.",
    })
  }
}

function unsupportedHarnessSelectionForWorkspace(
  workspace: WorkspaceRow | undefined,
): UnsupportedHarnessSelectionResult | null {
  const rootPath = workspace?.root_path?.trim()
  if (!rootPath) return null
  const workspaceConfig = readWorkspaceConfigSync(rootPath)
  if (!workspaceConfig) return null
  const validation = validateExecutionRoleOpenCodeSelection(workspaceConfig.harnessProfile)
  if (validation.ok) return null
  return {
    ok: false,
    status: 409,
    error: validation.error.code,
    code: validation.error.code,
    message: validation.error.detail,
    role: validation.error.role,
  }
}

function missingSupabaseCapabilityRequirements(workspace: WorkspaceRow, token: string | null): string[] {
  const missing: string[] = []
  if (!token) missing.push("management token")
  if (workspace.supabase_db_mode !== "direct" && !workspace.supabase_persistent_test_branch_ref?.trim()) {
    missing.push("persistent test branch")
  }
  return missing
}

function configuredSupabaseCapabilityFailure(workspace: WorkspaceRow, token: string | null): WorkflowCapabilityBlockedResult | null {
  const missing = missingSupabaseCapabilityRequirements(workspace, token)
  if (missing.length === 0) return null
  return buildWorkflowCapabilityBlockedResult({
    status: 400,
    reason: "incomplete_config",
    message: `Supabase capability is configured but incomplete. Missing ${missing.join(" and ")}.`,
  })
}

function defaultSupabaseAdapterFactory(
  repos: Repos,
  token: string,
  providedFactory?: SupabaseAdapterFactory,
): WorkflowCapabilityBag {
  if (providedFactory) return { supabaseAdapterFactory: providedFactory }
  return {
    supabaseAdapterFactory: () => {
      const client = new SupabaseManagementClient({ token })
      return {
        adapter: createSupabaseAdapter({
          repos,
          client,
        }),
        managementClient: client,
        handoffClient: client,
      }
    },
  }
}

export function resolveWorkflowCapabilities(input: WorkflowCapabilityResolverInput): WorkflowCapabilityResolution {
  if (!input.workspace?.supabase_project_ref) {
    return { supabaseAdapterFactory: null }
  }
  const injectedFailure = workflowCapabilityFailureFixture()
  if (injectedFailure) return injectedFailure

  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  const configuredFailure = configuredSupabaseCapabilityFailure(input.workspace, token)
  if (configuredFailure) return configuredFailure

  return defaultSupabaseAdapterFactory(input.repos, token as string, input.supabaseAdapterFactory)
}

// Test-only smoke hook: forces every reviewed runService entry surface to
// surface the same clear ownership failure without requiring live Supabase.
function workflowCapabilityOwnershipBlocker(): WorkflowCapabilityOwnershipBlockedResult | null {
  const message = process.env.BEERENGINEER_TEST_CAPABILITY_OWNERSHIP_FAILURE?.trim()
  if (!message) return null
  return {
    ok: false,
    status: 409,
    error: "workflow_capability_blocked",
    code: "workflow_capability_blocked",
    message,
  }
}

function buildApiIo(repos: Repos): WorkflowIO & { bus: EventBus } {
  const bus = createBus()
  const detachPersistence = withPromptPersistence(bus, repos)
  const io = busToWorkflowIO(bus)
  const originalClose = io.close
  return {
    ...io,
    close() {
      detachPersistence()
      originalClose?.()
    },
  }
}

function fireInBackground(io: WorkflowIO & { bus?: EventBus }, label: string, task: () => Promise<void>): void {
  task()
    .catch(err => {
      const e = err as Error
      process.stderr.write(`[runService:${label}] ${e.message}\n${e.stack ?? ""}\n`)
    })
    .finally(() => {
      io.close?.()
    })
}

function resolveAdmissionController(
  repos: Repos,
  controller?: WorkerAdmissionController,
): WorkerAdmissionController {
  return controller ?? getWorkerAdmissionController(repos)
}

function queueDeferredStart(
  controller: WorkerAdmissionController,
  runId: string,
  start: () => Promise<void>,
): () => Promise<void> {
  let completion: Promise<void> | null = null
  return async () => {
    if (completion) return completion
    completion = new Promise<void>((resolve, reject) => {
      controller.enqueue(runId, async () => {
        try {
          await start()
          resolve()
        } catch (error) {
          reject(error)
          throw error
        }
      })
    })
    return completion
  }
}

type BackgroundRunner = typeof fireInBackground
type PrepareRunImpl = typeof prepareRun
type PerformResumeImpl = (input: PerformResumeInput) => Promise<void>

type AnswerRunPromptOptions = {
  resumeBlockedRunInProcess?: boolean
  backgroundRunner?: BackgroundRunner
  apiWorkerInstanceId?: string
  workerLeaseClock?: () => number
  workerLeaseScheduler?: WorkerLeaseScheduler
  onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  supabaseAdapterFactory?: SupabaseAdapterFactory
  capabilityResolver?: WorkflowCapabilityResolver
  resumeRunImpl?: PerformResumeImpl
}

function shouldResumeBlockedRunAfterAnswer(run: RunRow | undefined): boolean {
  return run?.status === "blocked" && run.recovery_status === "blocked"
}

function promptAnswerResumeSummary(source: AnswerSource): string {
  return `Operator answered a pending prompt via ${source}.`
}

function mergeGatePromptAnswerForResume(
  repos: Repos,
  runBeforeAnswer: RunRow | undefined,
  runId: string,
  promptId: string,
  answer: string,
): string | undefined {
  if (runBeforeAnswer?.recovery_scope === "stage" && runBeforeAnswer.recovery_scope_ref === "merge-gate") {
    return answer.trim()
  }
  const prompt = repos.getPendingPrompt(promptId)
  if (!prompt?.stage_run_id) return undefined
  const stageRun = repos.listStageRunsForRun(runId).find(row => row.id === prompt.stage_run_id)
  return stageRun?.stage_key === "merge-gate" ? answer.trim() : undefined
}

export async function answerRunPromptInProcess(
  repos: Repos,
  input: { runId: string; promptId?: string; answer: string; source: AnswerSource },
  options: AnswerRunPromptOptions = {},
): Promise<AnswerResult> {
  const runBeforeAnswer = repos.getRun(input.runId)
  const result = recordAnswer(repos, input)
  if (result.ok && options.resumeBlockedRunInProcess && shouldResumeBlockedRunAfterAnswer(runBeforeAnswer)) {
    const promptAnswer = mergeGatePromptAnswerForResume(repos, runBeforeAnswer, input.runId, result.promptId, input.answer)
    const io = buildApiIo(repos)
    const prepared = await prepareForegroundResumeRun(repos, io, {
      runId: input.runId,
      summary: promptAnswerResumeSummary(input.source),
      promptAnswer,
      workerOwnerKind: "api",
      workerInstanceId: options.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: options.workerLeaseClock,
      workerLeaseScheduler: options.workerLeaseScheduler,
      onItemColumnChanged: options.onItemColumnChanged,
      supabaseAdapterFactory: options.supabaseAdapterFactory,
      capabilityResolver: options.capabilityResolver,
      resumeRunImpl: options.resumeRunImpl,
      persistItemDecision: false,
    })
    if (prepared.ok) {
      ;(options.backgroundRunner ?? fireInBackground)(io, "answerRunPromptInProcess", prepared.start)
    } else {
      io.close?.()
    }
  }
  return result
}

function hasStageArtifacts(
  repos: Repos,
  item: Pick<ItemRow, "id" | "workspace_id">,
  runId: string,
  stageId: string,
): boolean {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForItemRun(repos, item, run) : null
  return ctx ? existsSync(layout.stageDir(ctx, stageId)) : false
}

function latestRunWithStageArtifacts(
  repos: Repos,
  item: Pick<ItemRow, "id" | "workspace_id">,
  stageId: string,
): RunRow | undefined {
  return repos
    .listRuns()
    .filter(run => run.item_id === item.id)
    .sort((a, b) => b.created_at - a.created_at)
    .find(run => hasStageArtifacts(repos, item, run.id, stageId))
}

function seedStageFromPreviousRun(
  repos: Repos,
  item: Pick<ItemRow, "workspace_id">,
  sourceRun: RunRow,
  targetRun: RunRow,
  stageId: string,
): boolean {
  const sourceCtx = resolveWorkflowContextForItemRun(repos, item, sourceRun)
  const targetCtx = resolveWorkflowContextForItemRun(repos, item, targetRun)
  if (!sourceCtx || !targetCtx) return false
  const sourceStageDir = layout.stageDir(sourceCtx, stageId)
  if (!existsSync(sourceStageDir)) return false
  cpSync(sourceStageDir, layout.stageDir(targetCtx, stageId), {
    recursive: true,
  })
  return true
}

function resolveWorkspaceMeta(
  repos: Repos,
  workspaceKey: string | undefined,
): { workspaceKey?: string; workspaceName?: string } | { error: "unknown_workspace" } {
  if (!workspaceKey) return {}
  const workspace = getRegisteredWorkspace(repos, workspaceKey)
  if (!workspace) return { error: "unknown_workspace" }
  return { workspaceKey: workspace.key, workspaceName: workspace.name }
}

/**
 * `POST /runs` — start a fresh run from a UI-supplied idea. No CLI intake
 * prompts; title + description arrive on the request body.
 */
export function startRunFromIdea(
  repos: Repos,
  input: {
    title: string
    description: string
    workspaceKey?: string
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    backgroundRunner?: BackgroundRunner
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
  },
): StartRunResult {
  const io = buildApiIo(repos)
  const prepared = prepareForegroundIdeaRun(repos, io, {
    title: input.title,
    description: input.description,
    workspaceKey: input.workspaceKey,
    owner: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  const runInBackground = input.backgroundRunner ?? fireInBackground
  runInBackground(io, "startRunFromIdea", prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId }
}

export function prepareForegroundIdeaRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    title: string
    description: string
    workspaceKey?: string
    owner?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    admissionController?: WorkerAdmissionController
    prepareRunImpl?: PrepareRunImpl
  },
): PreparedForegroundRunResult {
  const meta = resolveWorkspaceMeta(repos, input.workspaceKey)
  if ("error" in meta) return { ok: false, status: 404, error: "unknown_workspace" }
  const workspace = input.workspaceKey ? repos.getWorkspaceByKey(input.workspaceKey) : undefined
  const unsupportedSelection = unsupportedHarnessSelectionForWorkspace(workspace)
  if (unsupportedSelection) return unsupportedSelection
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const capabilities = capabilitiesResult
  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker
  const admission = resolveAdmissionController(repos, input.admissionController)
  const shouldQueue = !admission.hasCapacity()

  const prepareRunImpl = input.prepareRunImpl ?? prepareRun
  const prepared = prepareRunImpl(
    { id: "new", title: input.title, description: input.description },
    repos,
    io,
    {
      owner: input.owner ?? "api",
      workerInstanceId: input.workerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      deferWorkerLease: shouldQueue,
      ...meta,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
    },
  )
  const start = shouldQueue
    ? queueDeferredStart(admission, prepared.runId, prepared.start)
    : () => admission.runAdmitted(prepared.runId, prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId, start }
}

/**
 * `POST /items/:id/actions/start_brainstorm` — start a fresh run for an
 * existing item.
 *
 * Manual design-prep actions (`start_visual_companion`,
 * `start_frontend_design`) reuse this entry point. Each seeds the prior
 * stages it depends on into the new run *before* spawning, so the workflow's
 * strict manual-mode gate never has to fall back to artifact regeneration.
 */
export type StartRunAction =
  | "start_brainstorm"
  | "start_visual_companion"
  | "start_frontend_design"
  | "start_implementation"
  | "rerun_design_prep"

export function isWorkflowStartGitBlockedResult(result: StartRunResult | PreparedImportRunResult): result is WorkflowStartGitBlockedResult {
  return !result.ok && "code" in result && result.code === "workflow_git_blocked"
}

export function isWorkflowCapabilityOwnershipBlockedResult(
  result: StartRunResult | ResumeRunResult | PreparedImportRunResult | PreparedForegroundRunResult | PreparedForegroundResumeRunResult | PreparedForegroundImportRunResult,
): result is WorkflowCapabilityOwnershipBlockedResult {
  return !result.ok && "code" in result && result.code === "workflow_capability_blocked" && !("reason" in result)
}

export function isWorkflowCapabilityBlockedResult(
  result: StartRunResult | ResumeRunResult | PreparedImportRunResult | PreparedForegroundRunResult | PreparedForegroundResumeRunResult | PreparedForegroundImportRunResult,
): result is WorkflowCapabilityOwnershipBlockedResult | WorkflowCapabilityBlockedResult {
  return !result.ok && "code" in result && result.code === "workflow_capability_blocked"
}

export function isUnsupportedHarnessSelectionResult(
  result: StartRunResult | PreparedImportRunResult | PreparedForegroundRunResult | PreparedForegroundImportRunResult,
): result is UnsupportedHarnessSelectionResult {
  return !result.ok && "code" in result && result.code === "unsupported_harness_selection"
}

export function isResumeOperatorDecisionResult(
  result: ResumeRunResult | PreparedForegroundResumeRunResult,
): result is Extract<ResumeRunResult, { ok: false; error: "operator_decision_required" }> {
  return !result.ok && result.error === "operator_decision_required"
}

export function isRetryRetainedConflictResult(
  result: RetryRetainedRunResult | PreparedForegroundRetryRetainedRunResult,
): result is Extract<RetryRetainedRunResult, { ok: false; error: "retry_retained_conflict" }> {
  return !result.ok && result.error === "retry_retained_conflict"
}

export function isClearAndFreshConflictResult(
  result: ClearAndFreshRunResult | PreparedForegroundClearAndFreshRunResult,
): result is Extract<ClearAndFreshRunResult, { ok: false; error: "clear_and_fresh_conflict" }> {
  return !result.ok && result.error === "clear_and_fresh_conflict"
}

const RETRY_RETAINED_REMEDIATION_SUMMARY = "Operator retried the retained diagnosis branch."
const RETRY_RETAINED_PRECONDITION_ERROR = "retry_retained_precondition_failed"
const CLEAR_AND_FRESH_REMEDIATION_SUMMARY = "Operator cleared the retained diagnosis branch and started a fresh recovery path."
const CLEAR_AND_FRESH_PRECONDITION_ERROR = "clear_and_fresh_precondition_failed"

function retryRetainedCurrentState(run: RunRow): RetryRetainedCurrentState {
  return {
    status: run.status,
    recoveryStatus: run.recovery_status,
    supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
  }
}

function retryRetainedConflict(run: RunRow): Extract<RetryRetainedRunResult, { ok: false; error: "retry_retained_conflict" }> {
  return {
    ok: false,
    status: 409,
    error: "retry_retained_conflict",
    code: "retry_retained_conflict",
    message: "retry-retained is only available while the run is retained for diagnosis.",
    currentState: retryRetainedCurrentState(run),
  }
}

function throwRetryRetainedPreconditionError(): never {
  throw new Error(RETRY_RETAINED_PRECONDITION_ERROR)
}

function clearAndFreshConflict(run: RunRow): Extract<ClearAndFreshRunResult, { ok: false; error: "clear_and_fresh_conflict" }> {
  return {
    ok: false,
    status: 409,
    error: "clear_and_fresh_conflict",
    code: "clear_and_fresh_conflict",
    message: "clear-and-fresh is only available while the run is retained for diagnosis.",
    currentState: retryRetainedCurrentState(run),
  }
}

function throwClearAndFreshPreconditionError(): never {
  throw new Error(CLEAR_AND_FRESH_PRECONDITION_ERROR)
}

type ResumeReadinessResult = Awaited<ReturnType<typeof loadResumeReadiness>>

type ClearAndFreshCapabilityContext = {
  ready: true
  capabilitiesResult: WorkflowCapabilityBag
  supabaseHook?: SupabaseWorkflowHook
}

function clearAndFreshReadinessFailure(
  readiness: ResumeReadinessResult,
): PreparedForegroundClearAndFreshRunResult | null {
  if (readiness.kind === "not_found") return { ok: false, status: 404, error: "run_not_found" }
  if (readiness.kind === "not_resumable") {
    return retainedDiagnosisRecoveryDecision(readiness.run)
      ? { ok: false, status: 409, error: readiness.reason }
      : clearAndFreshConflict(readiness.run)
  }
  if (readiness.kind !== "ready") return clearAndFreshConflict(readiness.run)
  if (retainedDiagnosisRecoveryDecision(readiness.run) == null) return clearAndFreshConflict(readiness.run)
  return null
}

function clearAndFreshPreconditionFailureResult(
  repos: Repos,
  runId: string,
): PreparedForegroundClearAndFreshRunResult {
  const currentRun = repos.getRun(runId)
  return currentRun
    ? clearAndFreshConflict(currentRun)
    : { ok: false, status: 404, error: "run_not_found" }
}

function resolveClearAndFreshCapabilityContext(
  repos: Repos,
  input: Pick<
    Parameters<typeof prepareForegroundClearAndFreshRun>[2],
    "runId" | "supabaseAdapterFactory" | "capabilityResolver"
  >,
  run: RunRow,
): PreparedForegroundClearAndFreshRunResult | ClearAndFreshCapabilityContext {
  const workspace = repos.getWorkspace(run.workspace_id)
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult

  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker

  const runAfterCapabilityCheck = repos.getRun(input.runId)
  if (!runAfterCapabilityCheck) return { ok: false, status: 404, error: "run_not_found" }
  if (retainedDiagnosisRecoveryDecision(runAfterCapabilityCheck) == null) {
    return clearAndFreshConflict(runAfterCapabilityCheck)
  }

  return {
    ready: true,
    capabilitiesResult,
    supabaseHook: buildSupabaseWorkflowHook(repos, run.workspace_id, workspace, capabilitiesResult.supabaseAdapterFactory),
  }
}

function cleanupFailureReason(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value
  if (value instanceof Error && value.message.trim()) return value.message
  if (value && typeof value === "object") {
    const row = value as { message?: unknown; error?: unknown }
    if (typeof row.message === "string" && row.message.trim()) return row.message
    if (typeof row.error === "string" && row.error.trim()) return row.error
  }
  return "Destroy failed"
}

async function runClearAndFreshBeforeResume(
  repos: Repos,
  runId: string,
  supabaseHook?: SupabaseWorkflowHook,
): Promise<void> {
  const run = repos.getRun(runId)
  if (!run) throwClearAndFreshPreconditionError()
  const branchRef = run.supabase_branch_ref
  const payload = updateSupabaseProvisioningRecoveryPayload(run.recovery_payload_json, {
    branchRef: null,
    operatorAction: "discard",
  })
  if (payload == null) {
    throwClearAndFreshPreconditionError()
  }
  const discarded = discardSupabaseBranchFromRunRecovery(repos, { runId })
  if (!discarded.ok) throwClearAndFreshPreconditionError()
  repos.setRunRecovery(runId, {
    status: run.recovery_status,
    scope: run.recovery_scope,
    scopeRef: run.recovery_scope_ref,
    summary: run.recovery_summary,
    payloadJson: payload,
  })

  if (branchRef && supabaseHook) {
    recordSupabaseLifecycle({
      repos,
      runId,
      branchRef,
      step: "cleanup",
      status: "in_progress",
    })
    try {
      const cleanup = await supabaseHook.adapter.destroyBranch({
        workspaceId: supabaseHook.workspaceId,
        projectRef: supabaseHook.projectRef,
        branchRef,
      })
      if (cleanup.ok) {
        recordSupabaseLifecycle({
          repos,
          runId,
          branchRef,
          step: "cleanup",
          status: "passed",
        })
      } else {
        recordSupabaseLifecycle({
          repos,
          runId,
          branchRef,
          step: "cleanup",
          status: "retained",
          reason: cleanupFailureReason(cleanup.context),
        })
      }
    } catch (error) {
      recordSupabaseLifecycle({
        repos,
        runId,
        branchRef,
        step: "cleanup",
        status: "retained",
        reason: cleanupFailureReason(error),
      })
    }
  }
}

function loadWorkflowGitGateConfig(): AppConfig {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  return resolveMergedConfig(readConfigFile(configPath), overrides) ?? defaultAppConfig()
}

function workflowGitBlockerMessage(error: WorkflowStartGitBlockedResult["error"], fallback?: string): string {
  if (error === "git_identity_missing") {
    return fallback ?? "Git identity is missing for this workspace. Repair it before starting the workflow."
  }
  if (error === "git_not_installed") {
    return fallback ?? "Git is not installed or not available on PATH. Install Git before starting workflows."
  }
  if (error === "workspace_not_found") {
    return "The item's registered workspace could not be found. Reconnect or select a valid workspace before starting."
  }
  if (error === "workspace_not_git_repo") {
    return fallback ?? "The registered workspace is not a Git repository. Select a Git workspace before starting."
  }
  return fallback ?? "The registered workspace path is unavailable. Reconnect the workspace before starting."
}

function workflowGitErrorFromReadiness(readiness: WorkspaceGitReadiness): WorkflowStartGitBlockedResult["error"] {
  const blocker = readiness.blocker?.error
  if (blocker === "identity_missing") return "git_identity_missing"
  if (blocker === "git_not_installed") return "git_not_installed"
  if (blocker === "workspace_not_git_repo") return "workspace_not_git_repo"
  if (blocker === "workspace_path_unavailable") return "workspace_path_unavailable"
  return "git_identity_missing"
}

export function checkWorkflowStartGitReadiness(
  repos: Repos,
  item: Pick<ItemRow, "id" | "workspace_id">,
  action: string,
  options: {
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
  } = {},
): { ok: true; readiness: WorkspaceGitReadiness } | WorkflowStartGitBlockedResult {
  const workspace = repos.getWorkspace(item.workspace_id)
  return checkWorkflowStartGitReadinessForWorkspace(workspace, { itemId: item.id, action }, options)
}

export function checkWorkflowStartGitReadinessForWorkspace(
  workspace: WorkspaceRow | undefined,
  intent: WorkflowStartGitBlockedResult["intent"],
  options: {
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
  } = {},
): { ok: true; readiness: WorkspaceGitReadiness } | WorkflowStartGitBlockedResult {
  if (!workspace) {
    return {
      ok: false,
      status: 404,
      error: "workspace_not_found",
      code: "workflow_git_blocked",
      message: workflowGitBlockerMessage("workspace_not_found"),
      intent,
    }
  }

  const appConfig = options.appConfig ?? loadWorkflowGitGateConfig()
  const readiness = readWorkspaceGitReadiness(
    { id: workspace.id, key: workspace.key, rootPath: workspace.root_path },
    appConfig,
    options.gitCommandOptions,
  )
  if (!readiness.workflowBlocked) return { ok: true, readiness }

  const error = workflowGitErrorFromReadiness(readiness)
  return {
    ok: false,
    status: 409,
    error,
    code: "workflow_git_blocked",
    message: workflowGitBlockerMessage(error, readiness.blocker?.message),
    readiness,
    repair: readiness.isGitRepo
      ? {
          action: "repair_workspace_identity",
          workspaceId: workspace.id,
          workspaceKey: workspace.key,
          appDefaultIdentityAvailable: Boolean(readiness.appDefaultIdentity),
        }
      : undefined,
    intent,
  }
}

type StartRunPreparation = {
  sourceRun?: RunRow
  resume?: WorkflowResumeInput
  seedStages: ReadonlyArray<string>
  error?: StartRunFailureResult
}

function prepareStartRunAction(repos: Repos, item: ItemRow, action: StartRunAction): StartRunPreparation {
  if (action === "start_implementation" || action === "rerun_design_prep") {
    const sourceRun = latestRunWithStageArtifacts(repos, item, "brainstorm")
    if (!sourceRun) return { seedStages: [], error: { ok: false, status: 409, error: "no_brainstorm_artifacts" } }
    return {
      sourceRun,
      resume: {
        scope: { type: "run", runId: "pending" },
        currentStage: action === "rerun_design_prep" ? "visual-companion" : "projects",
      },
      seedStages: ["brainstorm", "visual-companion", "frontend-design"],
    }
  }
  if (action === "start_visual_companion") {
    const sourceRun = latestRunWithStageArtifacts(repos, item, "brainstorm")
    if (!sourceRun) return { seedStages: [], error: { ok: false, status: 409, error: "no_brainstorm_artifacts" } }
    return {
      sourceRun,
      resume: {
        scope: { type: "run", runId: "pending" },
        currentStage: "visual-companion",
        manualStage: "visual-companion",
      },
      seedStages: ["brainstorm"],
    }
  }
  if (action === "start_frontend_design") {
    const sourceRun = latestRunWithStageArtifacts(repos, item, "visual-companion")
    if (!sourceRun) return { seedStages: [], error: { ok: false, status: 409, error: "no_visual_companion_artifacts" } }
    return {
      sourceRun,
      resume: {
        scope: { type: "run", runId: "pending" },
        currentStage: "frontend-design",
        manualStage: "frontend-design",
      },
      seedStages: ["brainstorm", "visual-companion"],
    }
  }
  return { seedStages: [] }
}

export function startRunForItem(
  repos: Repos,
  input: {
    itemId: string
    action: StartRunAction
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
  },
): StartRunResult {
  const io = buildApiIo(repos)
  const prepared = prepareForegroundItemRun(repos, io, {
    itemId: input.itemId,
    action: input.action,
    appConfig: input.appConfig,
    gitCommandOptions: input.gitCommandOptions,
    owner: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, `startRunForItem:${input.action}`, prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId }
}

export function prepareForegroundItemRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    itemId: string
    action: StartRunAction
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
    owner?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    admissionController?: WorkerAdmissionController
    prepareRunImpl?: PrepareRunImpl
  },
): PreparedForegroundRunResult {
  const item = repos.getItem(input.itemId)
  if (!item) return { ok: false, status: 404, error: "item_not_found" }
  const workspace = repos.getWorkspace(item.workspace_id)
  const unsupportedSelection = unsupportedHarnessSelectionForWorkspace(workspace)
  if (unsupportedSelection) return unsupportedSelection
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const capabilities = capabilitiesResult

  const preparedAction = prepareStartRunAction(repos, item, input.action)
  if (preparedAction.error) return preparedAction.error

  const gitGate = checkWorkflowStartGitReadiness(repos, item, input.action, {
    appConfig: input.appConfig,
    gitCommandOptions: input.gitCommandOptions,
  })
  if (!gitGate.ok) return gitGate
  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker
  const admission = resolveAdmissionController(repos, input.admissionController)
  const shouldQueue = !admission.hasCapacity()

  const workflowItem = { id: item.id, title: item.title, description: item.description }
  const prepareOptions = {
    owner: input.owner ?? "api",
    workerInstanceId: input.workerInstanceId,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    deferWorkerLease: shouldQueue,
    itemId: item.id,
    resume: preparedAction.resume,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
  }
  const prepared = input.prepareRunImpl
    ? input.prepareRunImpl(workflowItem, repos, io, prepareOptions)
    : prepareRun(workflowItem, repos, io, prepareOptions)

  if (preparedAction.sourceRun && preparedAction.seedStages.length > 0) {
    // Brainstorm is the only stage required by every downstream branch,
    // so absent seed there is fatal. The other stages are best-effort —
    // a manual `start_visual_companion` legitimately has no prior visual
    // artifacts to seed.
    const brainstormRequired = preparedAction.seedStages.includes("brainstorm")
    for (const stageId of preparedAction.seedStages) {
      const targetRun = repos.getRun(prepared.runId)
      const seeded = targetRun
        ? seedStageFromPreviousRun(repos, item, preparedAction.sourceRun, targetRun, stageId)
        : false
      if (!seeded && stageId === "brainstorm" && brainstormRequired) {
        return { ok: false, status: 409, error: "seed_failed" }
      }
    }
  }

  const start = shouldQueue
    ? queueDeferredStart(admission, prepared.runId, prepared.start)
    : () => admission.runAdmitted(prepared.runId, prepared.start)
  return { ok: true, runId: prepared.runId, itemId: item.id, start }
}

export async function startPreparedImportForItem(
  repos: Repos,
  input: {
    itemId?: string
    sourceDir: string
    workspaceKey?: string
    owner?: "cli" | "api"
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    importContextGenerator?: ImportContextGenerator
    prepareRunImpl?: PrepareRunImpl
  },
): Promise<PreparedImportRunResult> {
  const io = buildApiIo(repos)
  const prepared = await prepareForegroundPreparedImportRun(repos, io, {
    itemId: input.itemId,
    sourceDir: input.sourceDir,
    workspaceKey: input.workspaceKey,
    owner: input.owner ?? "api",
    appConfig: input.appConfig,
    gitCommandOptions: input.gitCommandOptions,
    workerInstanceId: input.owner === "cli" ? undefined : input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
    capabilityResolver: input.capabilityResolver,
    importContextGenerator: input.importContextGenerator,
    prepareRunImpl: input.prepareRunImpl,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, "startPreparedImportForItem", prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId, warnings: prepared.warnings }
}

export async function prepareForegroundPreparedImportRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    itemId?: string
    sourceDir: string
    workspaceKey?: string
    owner?: "cli" | "api"
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    importContextGenerator?: ImportContextGenerator
    admissionController?: WorkerAdmissionController
    prepareRunImpl?: PrepareRunImpl
  },
): Promise<PreparedForegroundImportRunResult> {
  const existingItem = input.itemId ? repos.getItem(input.itemId) : undefined
  if (input.itemId && !existingItem) return { ok: false, status: 404, error: "item_not_found" }

  const workspaceResult = resolvePreparedImportWorkspace(repos, existingItem, input.workspaceKey)
  if (!workspaceResult.ok) return workspaceResult.error
  const workspace = workspaceResult.workspace
  const unsupportedSelection = unsupportedHarnessSelectionForWorkspace(workspace)
  if (unsupportedSelection) return unsupportedSelection
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const capabilities = capabilitiesResult

  const gitGate = checkWorkflowStartGitReadinessForWorkspace(
    workspace,
    { itemId: existingItem?.id ?? "new", action: "import_prepared" },
    { appConfig: input.appConfig, gitCommandOptions: input.gitCommandOptions },
  )
  if (!gitGate.ok) return gitGate
  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker

  let bundle: PreparedImportBundle
  let importContext
  try {
    const llm = await resolveWorkflowLlmOptions(workspace)
    const generated = await (input.importContextGenerator ?? defaultImportContextGenerator)({
      sourceDir: input.sourceDir,
      item: {
        title: existingItem?.title ?? "Prepared import",
        description: existingItem?.description ?? "",
      },
      llm: llm?.stage,
    })
    bundle = generated.bundle
    importContext = generated.importContext
  } catch (error) {
    return { ok: false, status: 422, error: (error as Error).message }
  }

  const resume = {
    scope: { type: "run", runId: "pending" } as const,
    currentStage: "projects",
    projectStartStages: deriveProjectStartStages(bundle),
    dirtyCheckIgnoredPaths: [input.sourceDir],
    skipDesignPrep: true,
  }
  const admission = resolveAdmissionController(repos, input.admissionController)
  const shouldQueue = !admission.hasCapacity()
  const prepareRunImpl = input.prepareRunImpl ?? prepareRun
  const prepared = prepareRunImpl(
    {
      id: existingItem?.id ?? "new",
      title: existingItem?.title ?? titleForPreparedImportItem(bundle),
      description: existingItem?.description ?? descriptionForPreparedImportItem(bundle),
    },
    repos,
    io,
    {
      owner: input.owner ?? "api",
      workerInstanceId: input.workerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      deferWorkerLease: shouldQueue,
      itemId: existingItem?.id,
      ...newItemWorkspaceFields(existingItem, workspace),
      resume,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
    },
  )
  const targetRun = repos.getRun(prepared.runId)
  const item = repos.getItem(prepared.itemId)
  if (!item) return { ok: false, status: 409, error: "seed_failed" }
  const ctx = targetRun ? resolveWorkflowContextForItemRun(repos, item, targetRun) : null
  if (!ctx) return { ok: false, status: 409, error: "seed_failed" }
  const seeded = seedPreparedImportArtifacts(ctx, bundle, { sourceDir: input.sourceDir })
  const importContextPath = writeImportContextArtifact(ctx, importContext)
  repos.recordArtifact({
    runId: prepared.runId,
    label: "Import Context",
    kind: "json",
    path: importContextPath,
  })
  const start = shouldQueue
    ? queueDeferredStart(admission, prepared.runId, prepared.start)
    : () => admission.runAdmitted(prepared.runId, prepared.start)
  return {
    ok: true,
    runId: prepared.runId,
    itemId: item.id,
    warnings: Array.from(new Set([...seeded.warnings, ...importContext.warnings])),
    start,
  }
}

function resolvePreparedImportWorkspace(
  repos: Repos,
  existingItem: ItemRow | undefined,
  workspaceKey: string | undefined,
): { ok: true; workspace: WorkspaceRow | undefined } | { ok: false; error: PreparedImportFailureResult } {
  if (existingItem) return { ok: true, workspace: repos.getWorkspace(existingItem.workspace_id) }
  if (!workspaceKey) {
    return {
      ok: true,
      workspace: repos.upsertWorkspace({
        key: "default",
        name: "Default Workspace",
        description: "beerengineer_ engine workspace",
      }),
    }
  }
  const workspace = repos.getWorkspaceByKey(workspaceKey)
  if (workspace) return { ok: true, workspace }
  return { ok: false, error: { ok: false, status: 404, error: "unknown_workspace" } }
}

function newItemWorkspaceFields(item: ItemRow | undefined, workspace: WorkspaceRow | undefined): { workspaceKey?: string; workspaceName?: string } {
  if (item !== undefined) return {}
  return { workspaceKey: workspace?.key, workspaceName: workspace?.name }
}

function titleForPreparedImportItem(bundle: PreparedImportBundle): string {
  return bundle.projects[0]?.name.trim()
    || firstLine(bundle.concept.summary)
    || "Prepared import"
}

function descriptionForPreparedImportItem(bundle: PreparedImportBundle): string {
  return bundle.projects[0]?.description.trim()
    || firstLine(bundle.concept.problem)
    || firstLine(bundle.concept.summary)
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? ""
}

/**
 * `POST /runs/:id/resume` — record a remediation and re-enter the workflow
 * in-process. Previously this route only persisted the remediation row and
 * returned `needsSpawn: true` to the UI.
 */
export async function resumeRunInProcess(
  repos: Repos,
  input: {
    runId: string
    summary: string
    branch?: string
    commit?: string
    reviewNotes?: string
    promptAnswer?: string
    resume?: WorkflowResumeInput
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<ResumeRunResult> {
  const io = buildApiIo(repos)
  const prepared = await prepareForegroundResumeRun(repos, io, {
    runId: input.runId,
    summary: input.summary,
    branch: input.branch,
    commit: input.commit,
    reviewNotes: input.reviewNotes,
    promptAnswer: input.promptAnswer,
    resume: input.resume,
    workerOwnerKind: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
    capabilityResolver: input.capabilityResolver,
    resumeRunImpl: input.resumeRunImpl,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, "resumeRunInProcess", prepared.start)
  return { ok: true, runId: prepared.runId, remediationId: prepared.remediationId }
}

export async function retryRetainedRunInProcess(
  repos: Repos,
  input: {
    runId: string
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<RetryRetainedRunResult> {
  const io = buildApiIo(repos)
  const prepared = await prepareForegroundRetryRetainedRun(repos, io, {
    runId: input.runId,
    workerOwnerKind: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
    capabilityResolver: input.capabilityResolver,
    resumeRunImpl: input.resumeRunImpl,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, "retryRetainedRunInProcess", prepared.start)
  return { ok: true, runId: prepared.runId, remediationId: prepared.remediationId }
}

export async function clearAndFreshRunInProcess(
  repos: Repos,
  input: {
    runId: string
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<ClearAndFreshRunResult> {
  const io = buildApiIo(repos)
  const prepared = await prepareForegroundClearAndFreshRun(repos, io, {
    runId: input.runId,
    workerOwnerKind: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
    capabilityResolver: input.capabilityResolver,
    resumeRunImpl: input.resumeRunImpl,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, "clearAndFreshRunInProcess", prepared.start)
  return { ok: true, runId: prepared.runId, remediationId: prepared.remediationId }
}

function latestCurrentStageRun(repos: Repos, run: RunRow): StageRunRow | null {
  if (!run.current_stage?.trim()) return null
  const currentStage = run.current_stage.trim()
  for (const stageRun of repos.listStageRunsForRun(run.id).slice().reverse()) {
    if (stageRun.stage_key === currentStage) return stageRun
  }
  return null
}

function hasOtherLiveRunForItem(repos: Repos, run: RunRow): boolean {
  return repos
    .listRunsForItem(run.item_id)
    .some(candidate => candidate.id !== run.id && (candidate.status === "running" || candidate.status === "blocked"))
}

function skipCurrentStageConflict(
  reason: SkipCurrentStageRejectionReason,
  message: string,
): Extract<SkipCurrentStageResult, { ok: false; error: "skip_current_stage_not_allowed" }> {
  return {
    ok: false,
    status: 409,
    error: "skip_current_stage_not_allowed",
    code: "skip_current_stage_not_allowed",
    message,
    reason,
  }
}

function skipCurrentStageWorkerIsLive(
  repos: Repos,
  run: RunRow,
  input: {
    now: number
    apiWorkerInstanceId: string
  },
): boolean {
  const lease = inspectWorkerLease(repos, run.id)
  if (!lease) return false
  return input.now - lease.heartbeatAt < STALE_WORKER_HEARTBEAT_MS
}

export function skipCurrentStageInProcess(
  repos: Repos,
  input: {
    runId: string
    now?: () => number
    apiWorkerInstanceId?: string
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  },
): SkipCurrentStageResult {
  const run = repos.getRun(input.runId)
  if (!run) return { ok: false, status: 404, error: "run_not_found" }

  const currentStage = run.current_stage?.trim() ?? ""
  if (!currentStage) {
    return skipCurrentStageConflict("no_current_stage", "skip-current-stage requires a current stage.")
  }

  const stageRun = latestCurrentStageRun(repos, run)
  if (stageRun?.status === "skipped") {
    return skipCurrentStageConflict("current_stage_skipped", "skip-current-stage is unavailable because the current stage is already skipped.")
  }
  if (stageRun && (stageRun.status === "completed" || stageRun.status === "failed")) {
    return skipCurrentStageConflict("current_stage_terminal", "skip-current-stage is unavailable because the current stage is already terminal.")
  }

  if (skipCurrentStageWorkerIsLive(repos, run, {
    now: input.now?.() ?? Date.now(),
    apiWorkerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
  })) {
    return skipCurrentStageConflict("current_stage_actively_worked", "skip-current-stage is unavailable while a live worker is still active on the current stage.")
  }

  const activeStageRun = stageRun ?? repos.createStageRun({ runId: run.id, stageKey: currentStage })
  repos.completeStageRun(activeStageRun.id, "skipped")
  repos.clearRunWorkerLease(run.id)
  repos.updateRun(run.id, {
    status: "blocked",
    current_stage: currentStage,
    recovery_status: "blocked",
    recovery_scope: "stage",
    recovery_scope_ref: currentStage,
    recovery_summary: `Operator skipped current stage "${currentStage}". Run remains paused for follow-up.`,
    recovery_payload_json: null,
  })
  if (!hasOtherLiveRunForItem(repos, run)) repos.setItemCurrentStage(run.item_id, null)
  const item = repos.getItem(run.item_id)
  if (item) {
    input.onItemColumnChanged?.({
      itemId: item.id,
      from: item.current_column,
      to: item.current_column,
      phaseStatus: item.phase_status,
    })
  }
  repos.appendLog({
    runId: run.id,
    stageRunId: activeStageRun.id,
    eventType: "stage_skipped",
    message: `stage ${currentStage} skipped by operator`,
    data: { stageRunId: activeStageRun.id, stageKey: currentStage },
  })
  const updated = repos.getRun(run.id)!
  return {
    ok: true,
    runId: updated.id,
    status: updated.status,
    recoveryStatus: updated.recovery_status,
  }
}

export async function resumeRunFromExistingRemediationInProcess(
  repos: Repos,
  input: {
    remediationId: string
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  },
): Promise<ResumeRunResult> {
  const remediation = repos.getExternalRemediation(input.remediationId)
  if (!remediation) return { ok: false, status: 404, error: "run_not_found" }
  const run = repos.getRun(remediation.run_id)
  if (!run) return { ok: false, status: 404, error: "run_not_found" }
  const workspace = repos.getWorkspace(run.workspace_id)
  const capabilitiesResult = resolveWorkflowCapabilities({ repos, workspace })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const supabaseHook = buildSupabaseWorkflowHook(
    repos,
    run.workspace_id,
    workspace,
    capabilitiesResult.supabaseAdapterFactory,
  )
  const io = buildApiIo(repos)
  fireInBackground(io, "resumeRunFromExistingRemediationInProcess", async () => {
    await performResume({
      repos,
      io,
      runId: remediation.run_id,
      remediation,
      workerOwnerKind: "api",
      workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      supabaseHook,
      onItemColumnChanged: input.onItemColumnChanged,
    })
  })
  return { ok: true, runId: remediation.run_id, remediationId: remediation.id }
}

const REPLAN_ACTIVE_HEARTBEAT_WINDOW_MS = 60_000
const REPLAN_ACTIVE_HINT = "Use POST /runs/:runId/block-now to pause, then replan." as const

function runAppearsActiveForReplan(
  repos: Repos,
  runId: string,
  now: number,
): { active: true; workerHeartbeatAt: string | null } | { active: false } {
  const run = repos.getRun(runId)
  if (!run) return { active: false }
  if (run.status !== "running") return { active: false }
  const lease = inspectWorkerLease(repos, runId)
  const heartbeatAt = lease?.heartbeatAt ?? null
  if (heartbeatAt == null) return { active: false }
  if (now - heartbeatAt >= REPLAN_ACTIVE_HEARTBEAT_WINDOW_MS) return { active: false }
  return { active: true, workerHeartbeatAt: new Date(heartbeatAt).toISOString() }
}

function persistedPlanExistsForRun(repos: Repos, run: RunRow): boolean {
  const ctx = requireWorkflowContextForRun(repos, run)
  return existsSync(join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"))
}

export async function replanRunInProcess(
  repos: Repos,
  input: {
    runId: string
    reason: string
    now?: () => number
    generatePlan?: Parameters<typeof performExplicitReplan>[0]["generatePlan"]
    hooks?: Parameters<typeof performExplicitReplan>[0]["hooks"]
  },
): Promise<ReplanRunResult> {
  const reason = input.reason.trim()
  if (!reason) {
    return { ok: false, status: 422, error: "reason_required", message: "Replan reason is required." }
  }
  const run = repos.getRun(input.runId)
  if (!run) {
    return { ok: false, status: 404, error: "run_not_found", message: `Run not found: ${input.runId}` }
  }
  if (!persistedPlanExistsForRun(repos, run)) {
    return { ok: false, status: 409, error: "replan_plan_missing", message: "Run has no persisted plan to replan yet." }
  }
  const active = runAppearsActiveForReplan(repos, input.runId, input.now?.() ?? Date.now())
  if (active.active) {
    return {
      ok: false,
      status: 409,
      error: "replan_run_active",
      message: "Run is still actively executing and cannot be replanned.",
      currentStatus: run.status,
      workerHeartbeatAt: active.workerHeartbeatAt,
      hint: REPLAN_ACTIVE_HINT,
    }
  }

  const io = buildApiIo(repos)
  if (!io.bus) {
    io.close?.()
    return { ok: false, status: 500, error: "replan_io_unavailable", message: "Replan IO is unavailable." }
  }

  const detach = attachRunSubscribers(io.bus, repos, { runId: run.id, itemId: run.item_id })
  try {
    const workspace = repos.getWorkspace(run.workspace_id)
    const llm = await resolveWorkflowLlmOptions(workspace)
    await performExplicitReplan({
      repos,
      io,
      runId: input.runId,
      reason,
      generatePlan: input.generatePlan ?? (async () => await generateReplacementPlanFromArtifacts({
        repos,
        runId: input.runId,
        llm: llm?.stage,
      })),
      hooks: input.hooks,
    })
    return { ok: true, runId: input.runId }
  } catch (error) {
    if (typeof error === "object" && error && "message" in error && String((error as Error).message).startsWith("run_not_found:")) {
      return { ok: false, status: 404, error: "run_not_found", message: `Run not found: ${input.runId}` }
    }
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "replan_failed",
      message: error instanceof Error ? error.message : "replan_failed",
    }
  } finally {
    detach()
    io.close?.()
  }
}

function recoveryLatestState(run: Pick<RunRow, "recovery_payload_json" | "supabase_branch_ref" | "supabase_branch_lifecycle_state">): RecoveryLatestState {
  return {
    recoveryPayloadJson: run.recovery_payload_json,
    supabaseBranchRef: run.supabase_branch_ref,
    supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
  }
}

function appendRunRecoveryActionLog(
  repos: Repos,
  result: LoggedRecoveryActionResult,
): void {
  repos.appendLog({
    runId: result.runId,
    eventType: "run_recovery_action",
    message: result.action,
    data: {
      action: result.action,
      outcome: result.outcome,
      reason: "reason" in result ? result.reason : undefined,
      latestState: result.latestState,
      recoveryStatus: "recoveryStatus" in result ? result.recoveryStatus : undefined,
      supabaseBranchLifecycleState: "supabaseBranchLifecycleState" in result ? result.supabaseBranchLifecycleState : undefined,
    },
  })
}

function latestStageRunForCurrentStage(
  repos: Repos,
  run: Pick<RunRow, "id" | "current_stage">,
): StageRunRow | null {
  const currentStage = run.current_stage?.trim()
  if (!currentStage) return null
  return repos
    .listStageRunsForRun(run.id)
    .filter(stageRun => stageRun.stage_key === currentStage)
    .at(-1) ?? null
}

function skipCurrentStageEligibility(
  repos: Repos,
  run: Pick<RunRow, "id" | "status" | "current_stage">,
): (
    | { eligible: true; currentStage: string; stageRun: StageRunRow | null }
    | { eligible: false; reason: SkipCurrentStageEligibilityReason }
  ) {
  const currentStage = run.current_stage?.trim() ?? ""
  if (!currentStage) return { eligible: false, reason: "no_current_stage" }

  const stageRun = latestStageRunForCurrentStage(repos, run)
  if (stageRun?.status === "skipped") {
    return { eligible: false, reason: "current_stage_already_skipped" }
  }
  if (stageRun && TERMINAL_STAGE_RUN_STATUSES.has(stageRun.status)) {
    return { eligible: false, reason: "current_stage_terminal" }
  }
  if (run.status !== "running") {
    return { eligible: false, reason: "current_stage_not_active" }
  }
  if (stageRun && !ACTIVE_STAGE_RUN_STATUSES.has(stageRun.status)) {
    return { eligible: false, reason: "current_stage_not_active" }
  }
  const lease = inspectWorkerLease(repos, run.id)
  if (lease && Date.now() - lease.heartbeatAt < STALE_WORKER_HEARTBEAT_MS) {
    return { eligible: false, reason: "current_stage_worker_active" }
  }
  return { eligible: true, currentStage, stageRun }
}

function skipCurrentStageRejection(
  action: Extract<ImplementedRunRecoveryAction, "skip_current_stage">,
  reason: SkipCurrentStageEligibilityReason,
): RecoveryActionRejectedResult {
  const message =
    reason === "no_current_stage"
      ? "Skip current stage is unavailable because the run has no current stage."
      : reason === "current_stage_not_active"
        ? "Skip current stage is unavailable because the current stage is not active."
        : reason === "current_stage_worker_active"
          ? "Skip current stage is unavailable because a worker still holds the active stage lease."
        : reason === "current_stage_terminal"
          ? "Skip current stage is unavailable because the current stage is already terminal."
          : "Skip current stage is unavailable because the current stage is already recorded as skipped."
  return {
    ok: false,
    status: 409,
    error: "recovery_action_ineligible",
    code: "invalid_transition",
    action,
    reason,
    message,
  }
}

export function projectRunRecoverySurface(
  repos: Repos,
  run: Pick<RunRow, "id" | "status" | "current_stage" | "recovery_status" | "recovery_payload_json" | "supabase_branch_ref" | "supabase_branch_lifecycle_state">,
): RunRecoverySurfaceProjection {
  const availableActions: ImplementedRunRecoveryAction[] = []
  if (skipCurrentStageEligibility(repos, run).eligible) {
    availableActions.push("skip_current_stage")
  }

  const payload = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
  if (!payload) {
    return {
      recoveryStatus: null,
      supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
      availableActions,
    }
  }

  if (payload.operatorAction === "discard") {
    return {
      recoveryStatus: FRESH_PATH_RECOVERY_STATUS,
      supabaseBranchLifecycleState: FRESH_PATH_RECOVERY_STATUS,
      availableActions,
    }
  }

  if (payload.operatorAction === "attach") {
    return {
      recoveryStatus: RETAINED_PATH_RECOVERY_STATUS,
      supabaseBranchLifecycleState: RETAINED_PATH_RECOVERY_STATUS,
      availableActions,
    }
  }

  if (run.recovery_status !== "blocked") {
    return {
      recoveryStatus: null,
      supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
      availableActions,
    }
  }

  const retainedBranchRef = payload.branchRef ?? run.supabase_branch_ref
  if (run.supabase_branch_lifecycle_state === "retained-for-diagnosis" && retainedBranchRef) {
    return {
      recoveryStatus: null,
      supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
      availableActions: [...availableActions, "retry_retained", "clear_and_fresh"],
    }
  }

  return {
    recoveryStatus: null,
    supabaseBranchLifecycleState: run.supabase_branch_lifecycle_state,
    availableActions: [...availableActions, "recover_fresh_branch"],
  }
}

function isReservedRunRecoveryAction(action: string): action is ReservedRunRecoveryAction {
  return RESERVED_RUN_RECOVERY_ACTIONS.includes(action as ReservedRunRecoveryAction)
}

function isImplementedRunRecoveryAction(action: string): action is ImplementedRunRecoveryAction {
  return IMPLEMENTED_RUN_RECOVERY_ACTIONS.includes(action as ImplementedRunRecoveryAction)
}

function isNarrowRunRecoveryClearAction(action: string): action is NarrowRunRecoveryClearAction {
  return NARROW_RUN_RECOVERY_CLEAR_ACTIONS.includes(action as NarrowRunRecoveryClearAction)
}

function unexpectedRecoveryActionFields(
  input: { runId: string } & RunRecoveryActionRequest,
  allowedKeys: string[],
): string[] {
  return Object.keys(input)
    .filter(key => !allowedKeys.includes(key))
    .sort((left, right) => left.localeCompare(right))
}

export function mutateRunRecoveryActionInProcess(
  repos: Repos,
  input: { runId: string } & RunRecoveryActionRequest,
): RunRecoveryActionResult {
  const run = repos.getRun(input.runId)
  if (!run) {
    return {
      ok: false,
      status: 404,
      error: "run_not_found",
      code: "not_found",
      reason: "run_not_found",
      message: `Run not found: ${input.runId}`,
    }
  }

  const action = typeof input.action === "string" ? input.action.trim() : ""
  if (!action) {
    return {
      ok: false,
      status: 400,
      error: "recovery_action_required",
      code: "bad_request",
      reason: "action_required",
      message: "Recovery action is required.",
    }
  }

  if (isReservedRunRecoveryAction(action)) {
    return {
      ok: false,
      status: 501,
      error: "recovery_action_reserved",
      code: "not_implemented",
      action,
      reason: "action_not_implemented",
      message: "Named recovery actions are reserved on POST /runs/:id/recovery and will be wired by later stories.",
    }
  }

  if (isImplementedRunRecoveryAction(action)) {
    const surface = projectRunRecoverySurface(repos, run)
    if (action === "skip_current_stage") {
      const eligibility = skipCurrentStageEligibility(repos, run)
      if (!eligibility.eligible) return skipCurrentStageRejection(action, eligibility.reason)

      const stageRun = eligibility.stageRun ?? repos.createStageRun({ runId: run.id, stageKey: eligibility.currentStage })
      repos.completeStageRun(stageRun.id, "skipped")
      repos.updateRun(run.id, {
        status: "blocked",
        current_stage: eligibility.currentStage,
        recovery_status: "blocked",
        recovery_scope: "stage",
        recovery_scope_ref: eligibility.currentStage,
        recovery_summary: `Current stage '${eligibility.currentStage}' was skipped. Manual review is required before continuing.`,
        recovery_payload_json: run.recovery_payload_json,
      })

      const next = repos.getRun(run.id) ?? run
      const result: RecoveryNamedAcceptedResult = {
        ok: true,
        runId: run.id,
        action,
        outcome: "accepted",
        latestState: recoveryLatestState(next),
        currentStage: eligibility.currentStage,
        stageStatus: "skipped",
        runStatus: "blocked",
        recoveryStatus: "blocked",
      }
      appendRunRecoveryActionLog(repos, result)
      return result
    }

    if (action === "clear_and_fresh" && surface.recoveryStatus === FRESH_PATH_RECOVERY_STATUS) {
      const result: RecoveryNamedNoopResult = {
        ok: true,
        runId: run.id,
        action,
        outcome: "noop",
        reason: "already_on_fresh_path",
        latestState: recoveryLatestState(run),
        recoveryStatus: FRESH_PATH_RECOVERY_STATUS,
        supabaseBranchLifecycleState: FRESH_PATH_RECOVERY_STATUS,
      }
      appendRunRecoveryActionLog(repos, result)
      return result
    }

    if (!surface.availableActions.includes(action)) {
      return {
        ok: false,
        status: 409,
        error: "recovery_action_ineligible",
        code: "invalid_transition",
        action,
        reason: "incompatible_recovery_state",
        message: "Recovery action is not available for this run.",
      }
    }

    const payload = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
    if (!payload) {
      return {
        ok: false,
        status: 409,
        error: "recovery_action_ineligible",
        code: "invalid_transition",
        action,
        reason: "incompatible_recovery_state",
        message: "Recovery action is not available for this run.",
      }
    }

    switch (action) {
      case "recover_fresh_branch":
        repos.setRunRecoveryPayloadJson(
          run.id,
          updateSupabaseProvisioningRecoveryPayload(run.recovery_payload_json, {
            branchRef: null,
            operatorAction: "discard",
          }) ?? run.recovery_payload_json,
        )
        break
      case "retry_retained":
        if (!(run.supabase_branch_ref ?? payload.branchRef)) {
          return {
            ok: false,
            status: 409,
            error: "recovery_action_ineligible",
            code: "invalid_transition",
            action,
            reason: "incompatible_recovery_state",
            message: "Recovery action is not available for this run.",
          }
        }
        repos.setRunRecoveryPayloadJson(
          run.id,
          updateSupabaseProvisioningRecoveryPayload(run.recovery_payload_json, {
            branchRef: run.supabase_branch_ref ?? payload.branchRef ?? null,
            operatorAction: "attach",
          }) ?? run.recovery_payload_json,
        )
        break
      case "clear_and_fresh":
        repos.setRunRecoverySupabaseBranchRef(run.id, null)
        repos.setRunRecoveryPayloadJson(
          run.id,
          updateSupabaseProvisioningRecoveryPayload(run.recovery_payload_json, {
            branchRef: null,
            operatorAction: "discard",
          }) ?? run.recovery_payload_json,
        )
        break
    }

    const next = repos.getRun(run.id) ?? run
    const projected = projectRunRecoverySurface(repos, next)
    const result: RecoveryNamedAcceptedResult = {
      ok: true,
      runId: run.id,
      action,
      outcome: "accepted",
      latestState: recoveryLatestState(next),
      recoveryStatus: projected.recoveryStatus as RecoveryPathStatus,
      supabaseBranchLifecycleState: projected.supabaseBranchLifecycleState as RecoveryPathStatus,
    }
    appendRunRecoveryActionLog(repos, result)
    return result
  }

  if (!isNarrowRunRecoveryClearAction(action)) {
    return {
      ok: false,
      status: 400,
      error: "unsupported_recovery_action",
      code: "bad_request",
      action,
      reason: "unsupported_action",
      message: "Unsupported recovery action.",
    }
  }

  const unexpectedFields = unexpectedRecoveryActionFields(input, ["runId", "action"])
  if (unexpectedFields.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "recovery_action_invalid_request",
      code: "bad_request",
      action,
      reason: "unexpected_fields",
      message: "This recovery action accepts only the action field.",
      fields: unexpectedFields,
    }
  }

  const before = recoveryLatestState(run)
  const currentValue =
    action === "clear_recovery_payload"
      ? before.recoveryPayloadJson
      : action === "clear_supabase_branch_ref"
        ? before.supabaseBranchRef
        : before.supabaseBranchLifecycleState

  if (currentValue == null) {
    const result: RecoveryClearNoopResult = {
      ok: true,
      runId: run.id,
      action,
      outcome: "noop",
      reason: "already_clear",
      latestState: before,
    }
    appendRunRecoveryActionLog(repos, result)
    return result
  }

  switch (action) {
    case "clear_recovery_payload":
      repos.setRunRecoveryPayloadJson(run.id, null)
      break
    case "clear_supabase_branch_ref":
      repos.setRunRecoverySupabaseBranchRef(run.id, null)
      break
    case "clear_supabase_branch_lifecycle_state":
      repos.setRunRecoverySupabaseLifecycleState(run.id, null)
      break
  }

  const result: RecoveryClearAcceptedResult = {
    ok: true,
    runId: run.id,
    action,
    outcome: "accepted",
    latestState: recoveryLatestState(repos.getRun(run.id) ?? run),
  }
  appendRunRecoveryActionLog(repos, result)
  return result
}

export async function autoResumeRunOnStartup(
  repos: Repos,
  input: {
    runId: string
    summary: string
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<ResumeRunResult> {
  const io = buildApiIo(repos)
  const prepared = await prepareForegroundResumeRun(repos, io, {
    runId: input.runId,
    summary: input.summary,
    workerOwnerKind: "api",
    workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
    workerLeaseClock: input.workerLeaseClock,
    workerLeaseScheduler: input.workerLeaseScheduler,
    onItemColumnChanged: input.onItemColumnChanged,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
    capabilityResolver: input.capabilityResolver,
    resumeRunImpl: input.resumeRunImpl,
    persistItemDecision: false,
  })
  if (!prepared.ok) {
    io.close?.()
    return prepared
  }
  fireInBackground(io, "autoResumeRunOnStartup", prepared.start)
  return { ok: true, runId: prepared.runId, remediationId: prepared.remediationId }
}

export async function prepareForegroundResumeRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    runId: string
    summary: string
    branch?: string
    commit?: string
    reviewNotes?: string
    promptAnswer?: string
    resume?: WorkflowResumeInput
    workerOwnerKind?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    admissionController?: WorkerAdmissionController
    resumeRunImpl?: PerformResumeImpl
    persistItemDecision?: boolean
    bypassRetainedDiagnosisDecision?: boolean
    verifyBeforeRemediation?: (run: RunRow) => void
  },
): Promise<PreparedForegroundResumeRunResult> {
  const summary = input.summary.trim()
  if (!summary) return { ok: false, status: 422, error: "remediation_required" }

  const readiness = await loadResumeReadiness(repos, input.runId)
  if (readiness.kind === "not_found") return { ok: false, status: 404, error: "run_not_found" }
  if (readiness.kind === "no_recovery") return { ok: false, status: 409, error: "not_resumable" }
  if (readiness.kind === "not_resumable") {
    return { ok: false, status: 409, error: readiness.reason }
  }
  const decision = retainedDiagnosisRecoveryDecision(readiness.run)
  if (decision && input.bypassRetainedDiagnosisDecision !== true) {
    return {
      ok: false,
      status: 409,
      error: "operator_decision_required",
      code: "operator_decision_required",
      message: "Run requires an explicit operator decision before recovery can continue.",
      decision,
    }
  }
  const workspace = repos.getWorkspace(readiness.run.workspace_id)
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const capabilities = capabilitiesResult
  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker
  const admission = resolveAdmissionController(repos, input.admissionController)
  const shouldQueue = !admission.hasCapacity()
  const supabaseHook = buildSupabaseWorkflowHook(
    repos,
    readiness.run.workspace_id,
    workspace,
    capabilities.supabaseAdapterFactory,
  )

  const scope = readiness.record.scope
  let scopeRef: string | null = null
  if (scope.type === "stage") scopeRef = scope.stageId
  else if (scope.type === "story") scopeRef = `${scope.waveNumber}/${scope.storyId}`

  const runBeforeRemediation = repos.getRun(input.runId)
  if (!runBeforeRemediation) return { ok: false, status: 404, error: "run_not_found" }
  input.verifyBeforeRemediation?.(runBeforeRemediation)

  const remediation: ExternalRemediationRow = repos.createExternalRemediation({
    runId: input.runId,
    scope: scope.type,
    scopeRef,
    summary,
    branch: input.branch,
    commitSha: input.commit,
          reviewNotes: input.reviewNotes,
          source: "api",
        })

  // A resume summary is an operator scope decision in plain text — persist
  // it at the workspace level so future runs of the same item respect it,
  // exactly like clarification answers do via recordAnswer.
  const run = repos.getRun(input.runId)
  const ctx = run ? resolveWorkflowContextForRun(repos, run) : null
  if (ctx && input.persistItemDecision !== false) {
    let decisionStage: string | null = null
    if (scope.type === "stage") decisionStage = scope.stageId
    else if (scope.type === "story") decisionStage = `execution/${scope.waveNumber}/${scope.storyId}`
    appendItemDecision(ctx, {
      id: `remediation-${remediation.id}`,
      stage: decisionStage,
      question: `[resume_run] Operator unblocked the run with explicit scope guidance.`,
      answer: input.reviewNotes ? `${summary}\n\nReview notes:\n${input.reviewNotes}` : summary,
      runId: input.runId,
      answeredAt: new Date().toISOString(),
    })
  }

  if (isExecutionOwnershipHandoffRun(readiness.run)) {
    queueExecutionOwnershipHandoffResume(repos, input.runId, remediation.id)
    return {
      ok: true,
      runId: input.runId,
      remediationId: remediation.id,
      start: async () => {},
    }
  }

  if (shouldQueue) {
    repos.updateRun(input.runId, { status: "queued" })
  }

  const start = async () => {
    const resumeRunImpl = input.resumeRunImpl ?? performResume
    const detachPromptAnswer = input.promptAnswer ? attachOneShotPromptAnswer(io, input.promptAnswer) : () => {}
    try {
      await resumeRunImpl({
        repos,
        io,
        runId: input.runId,
        remediation,
        resume: input.resume,
        workerOwnerKind: input.workerOwnerKind ?? "api",
        workerInstanceId: input.workerInstanceId,
        workerLeaseClock: input.workerLeaseClock,
        workerLeaseScheduler: input.workerLeaseScheduler,
        supabaseHook,
        onItemColumnChanged: input.onItemColumnChanged,
      })
    } finally {
      detachPromptAnswer()
    }
  }

  return {
    ok: true,
    runId: input.runId,
    remediationId: remediation.id,
    start: shouldQueue
      ? queueDeferredStart(admission, input.runId, start)
      : () => admission.runAdmitted(input.runId, start),
  }
}

export async function prepareForegroundRetryRetainedRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    runId: string
    workerOwnerKind?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    admissionController?: WorkerAdmissionController
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<PreparedForegroundRetryRetainedRunResult> {
  const readiness = await loadResumeReadiness(repos, input.runId)
  if (readiness.kind === "not_found") return { ok: false, status: 404, error: "run_not_found" }
  if (readiness.kind === "not_resumable") {
    if (retainedDiagnosisRecoveryDecision(readiness.run)) {
      return { ok: false, status: 409, error: readiness.reason }
    }
    return retryRetainedConflict(readiness.run)
  }
  if (readiness.kind !== "ready") return retryRetainedConflict(readiness.run)
  if (!retainedDiagnosisRecoveryDecision(readiness.run)) return retryRetainedConflict(readiness.run)

  let prepared: PreparedForegroundResumeRunResult
  try {
    prepared = await prepareForegroundResumeRun(repos, io, {
      runId: input.runId,
      summary: RETRY_RETAINED_REMEDIATION_SUMMARY,
      workerOwnerKind: input.workerOwnerKind,
      workerInstanceId: input.workerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: input.supabaseAdapterFactory,
      capabilityResolver: input.capabilityResolver,
      admissionController: input.admissionController,
      resumeRunImpl: input.resumeRunImpl,
      persistItemDecision: false,
      bypassRetainedDiagnosisDecision: true,
      verifyBeforeRemediation: run => {
        if (!retainedDiagnosisRecoveryDecision(run)) throwRetryRetainedPreconditionError()
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === RETRY_RETAINED_PRECONDITION_ERROR) {
      const currentRun = repos.getRun(input.runId)
      return currentRun
        ? retryRetainedConflict(currentRun)
        : { ok: false, status: 404, error: "run_not_found" }
    }
    throw error
  }

  if (prepared.ok && repos.getRun(input.runId)?.status === "blocked") {
    repos.updateRun(input.runId, { status: "queued" })
  }

  return prepared
}

export async function prepareForegroundClearAndFreshRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    runId: string
    workerOwnerKind?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    admissionController?: WorkerAdmissionController
    resumeRunImpl?: PerformResumeImpl
  },
): Promise<PreparedForegroundClearAndFreshRunResult> {
  const readiness = await loadResumeReadiness(repos, input.runId)
  const readinessFailure = clearAndFreshReadinessFailure(readiness)
  if (readinessFailure) return readinessFailure

  const capabilityContext = resolveClearAndFreshCapabilityContext(repos, input, readiness.run)
  if (!capabilityContext.ready) return capabilityContext

  let prepared: PreparedForegroundResumeRunResult
  try {
    await runClearAndFreshBeforeResume(repos, input.runId, capabilityContext.supabaseHook)
    prepared = await prepareForegroundResumeRun(repos, io, {
      runId: input.runId,
      summary: CLEAR_AND_FRESH_REMEDIATION_SUMMARY,
      workerOwnerKind: input.workerOwnerKind,
      workerInstanceId: input.workerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      onItemColumnChanged: input.onItemColumnChanged,
      capabilityResolver: () => capabilityContext.capabilitiesResult,
      admissionController: input.admissionController,
      resumeRunImpl: input.resumeRunImpl,
      persistItemDecision: false,
      bypassRetainedDiagnosisDecision: true,
    })
  } catch (error) {
    if (error instanceof Error && error.message === CLEAR_AND_FRESH_PRECONDITION_ERROR) {
      return clearAndFreshPreconditionFailureResult(repos, input.runId)
    }
    throw error
  }

  if (prepared.ok && repos.getRun(input.runId)?.status === "blocked") {
    repos.updateRun(input.runId, { status: "queued" })
  }

  return prepared
}

// Re-export the event type for convenience.
export type { WorkflowEvent } from "./runOrchestrator.js"

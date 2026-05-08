import { cpSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { busToWorkflowIO, createBus, type EventBus } from "./bus.js"
import { appendItemDecision } from "./itemDecisions.js"
import { withPromptPersistence } from "./promptPersistence.js"
import { prepareRun, type SupabaseAdapterFactory } from "./runOrchestrator.js"
import { resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { loadResumeReadiness, performResume, type PerformResumeInput } from "./resume.js"
import { getRegisteredWorkspace } from "./workspaces.js"
import { deriveProjectStartStages, loadPreparedImportBundleWithLlmFallback, seedPreparedImportArtifacts, type PreparedImportBundle } from "./preparedImport.js"
import { layout } from "./workspaceLayout.js"
import { resolveWorkflowContextForItemRun, resolveWorkflowContextForRun } from "./workflowContextResolver.js"
import type { Repos, ItemRow, RunRow, ExternalRemediationRow, WorkspaceRow } from "../db/repositories.js"
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

export type StartRunResult =
  | { ok: true; runId: string; itemId: string }
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

type StartRunFailureResult = Exclude<StartRunResult, { ok: true; runId: string; itemId: string }>

export type PreparedForegroundRunResult =
  | { ok: true; runId: string; itemId: string; start: () => Promise<void> }
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

export type ResumeRunResult =
  | { ok: true; runId: string; remediationId: string }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedForegroundResumeRunResult =
  | { ok: true; runId: string; remediationId: string; start: () => Promise<void> }
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedImportRunResult =
  | { ok: true; runId: string; itemId: string; warnings: string[] }
  | WorkflowStartGitBlockedResult
  | WorkflowCapabilityOwnershipBlockedResult
  | WorkflowCapabilityBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

type PreparedImportFailureResult = Exclude<PreparedImportRunResult, { ok: true; runId: string; itemId: string; warnings: string[] }>

export type PreparedForegroundImportRunResult =
  | { ok: true; runId: string; itemId: string; warnings: string[]; start: () => Promise<void> }
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
    const status = parsed.status === 400 || parsed.status === 409 || parsed.status === 503
      ? parsed.status
      : reason === "incomplete_config"
        ? 400
        : reason === "gate_blocked"
          ? 409
          : 503
    const secrets = Array.isArray(parsed.secrets)
      ? parsed.secrets.filter((value): value is string => typeof value === "string" && value.length > 0)
      : []
    return buildWorkflowCapabilityBlockedResult({
      status,
      reason,
      message: typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message
        : "Supabase capability is blocked.",
      secrets,
    })
  } catch {
    return buildWorkflowCapabilityBlockedResult({
      status: 503,
      reason: "blocked_readiness",
      message: "Supabase capability is blocked by an unreadable test fixture.",
    })
  }
}

export function resolveWorkflowCapabilities(input: WorkflowCapabilityResolverInput): WorkflowCapabilityResolution {
  if (!input.workspace?.supabase_project_ref) {
    return { supabaseAdapterFactory: null }
  }
  const injectedFailure = workflowCapabilityFailureFixture()
  if (injectedFailure) return injectedFailure

  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  const missing: string[] = []
  if (!token) missing.push("management token")
  if (!input.workspace.supabase_persistent_test_branch_ref?.trim()) missing.push("persistent test branch")
  if (missing.length > 0) {
    return buildWorkflowCapabilityBlockedResult({
      status: 400,
      reason: "incomplete_config",
      message: `Supabase capability is configured but incomplete. Missing ${missing.join(" and ")}.`,
    })
  }
  const resolvedToken = token as string

  if (input.supabaseAdapterFactory) {
    return { supabaseAdapterFactory: input.supabaseAdapterFactory }
  }

  return {
    supabaseAdapterFactory: () => ({
      adapter: createSupabaseAdapter({
        repos: input.repos,
        client: new SupabaseManagementClient({ token: resolvedToken }),
      }),
    }),
  }
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

type BackgroundRunner = typeof fireInBackground
type PrepareRunImpl = typeof prepareRun
type PerformResumeImpl = (input: PerformResumeInput) => Promise<void>

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
    prepareRunImpl?: PrepareRunImpl
  },
): PreparedForegroundRunResult {
  const meta = resolveWorkspaceMeta(repos, input.workspaceKey)
  if ("error" in meta) return { ok: false, status: 404, error: "unknown_workspace" }
  const workspace = input.workspaceKey ? repos.getWorkspaceByKey(input.workspaceKey) : undefined
  const capabilitiesResult = (input.capabilityResolver ?? resolveWorkflowCapabilities)({
    repos,
    workspace,
    supabaseAdapterFactory: input.supabaseAdapterFactory,
  })
  if (!isWorkflowCapabilityBag(capabilitiesResult)) return capabilitiesResult
  const capabilities = capabilitiesResult
  const blocker = workflowCapabilityOwnershipBlocker()
  if (blocker) return blocker

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
      ...meta,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
    },
  )
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId, start: prepared.start }
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
    prepareRunImpl?: PrepareRunImpl
  },
): PreparedForegroundRunResult {
  const item = repos.getItem(input.itemId)
  if (!item) return { ok: false, status: 404, error: "item_not_found" }
  const workspace = repos.getWorkspace(item.workspace_id)
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

  const prepareRunImpl = input.prepareRunImpl ?? prepareRun
  const prepared = prepareRunImpl(
    { id: item.id, title: item.title, description: item.description },
    repos,
    io,
    {
      owner: input.owner ?? "api",
      workerInstanceId: input.workerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      itemId: item.id,
      resume: preparedAction.resume,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
    },
  )

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

  return { ok: true, runId: prepared.runId, itemId: item.id, start: prepared.start }
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
    prepareRunImpl?: PrepareRunImpl
  },
): Promise<PreparedForegroundImportRunResult> {
  const existingItem = input.itemId ? repos.getItem(input.itemId) : undefined
  if (input.itemId && !existingItem) return { ok: false, status: 404, error: "item_not_found" }

  const workspaceResult = resolvePreparedImportWorkspace(repos, existingItem, input.workspaceKey)
  if (!workspaceResult.ok) return workspaceResult.error
  const workspace = workspaceResult.workspace
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
  try {
    const llm = await resolveWorkflowLlmOptions(workspace)
    bundle = await loadPreparedImportBundleWithLlmFallback(
      input.sourceDir,
      {
        title: existingItem?.title ?? "Prepared import",
        description: existingItem?.description ?? "",
      },
      llm?.stage,
    )
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
  return { ok: true, runId: prepared.runId, itemId: item.id, warnings: seeded.warnings, start: prepared.start }
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

export async function prepareForegroundResumeRun(
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  input: {
    runId: string
    summary: string
    branch?: string
    commit?: string
    reviewNotes?: string
    workerOwnerKind?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    supabaseAdapterFactory?: SupabaseAdapterFactory
    capabilityResolver?: WorkflowCapabilityResolver
    resumeRunImpl?: PerformResumeImpl
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

  const scope = readiness.record.scope
  let scopeRef: string | null = null
  if (scope.type === "stage") scopeRef = scope.stageId
  else if (scope.type === "story") scopeRef = `${scope.waveNumber}/${scope.storyId}`

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
  if (ctx) {
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

  return {
    ok: true,
    runId: input.runId,
    remediationId: remediation.id,
    start: () => {
      const resumeRunImpl = input.resumeRunImpl ?? performResume
      return resumeRunImpl({
        repos,
        io,
        runId: input.runId,
        remediation,
        workerOwnerKind: input.workerOwnerKind ?? "api",
        workerInstanceId: input.workerInstanceId,
        workerLeaseClock: input.workerLeaseClock,
        workerLeaseScheduler: input.workerLeaseScheduler,
        supabaseAdapterFactory: capabilities.supabaseAdapterFactory,
        onItemColumnChanged: input.onItemColumnChanged,
      })
    },
  }
}

// Re-export the event type for convenience.
export type { WorkflowEvent } from "./runOrchestrator.js"

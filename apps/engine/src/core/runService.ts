import { cpSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { busToWorkflowIO, createBus, type EventBus } from "./bus.js"
import { appendItemDecision } from "./itemDecisions.js"
import { withPromptPersistence } from "./promptPersistence.js"
import { prepareRun } from "./runOrchestrator.js"
import { resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { loadResumeReadiness, performResume } from "./resume.js"
import { getRegisteredWorkspace } from "./workspaces.js"
import { deriveProjectStartStages, loadPreparedImportBundleWithLlmFallback, seedPreparedImportArtifacts, type PreparedImportBundle } from "./preparedImport.js"
import { layout } from "./workspaceLayout.js"
import { resolveWorkflowContextForItemRun, resolveWorkflowContextForRun } from "./workflowContextResolver.js"
import type { Repos, ItemRow, RunRow, ExternalRemediationRow, WorkspaceRow } from "../db/repositories.js"
import type { WorkflowIO } from "./io.js"
import type { WorkflowResumeInput } from "../workflow.js"
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides } from "../setup/config.js"
import { readWorkspaceGitReadiness, type GitCommandOptions, type WorkspaceGitReadiness } from "../setup/gitIdentity.js"
import type { AppConfig } from "../setup/types.js"
import type { SupabaseAdapter } from "./supabase/types.js"
import type { SupabaseHandoffClient } from "./supabase/handoffWriter.js"
import type { WorkerLeaseScheduler } from "./workerLease.js"

/** Factory type re-exported so server.ts can build it without importing from runOrchestrator. */
export type SupabaseAdapterFactory = (deps: { workspaceId: string; projectRef: string }) => {
  adapter: SupabaseAdapter
  handoffClient?: SupabaseHandoffClient
} | null

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

export type StartRunResult =
  | { ok: true; runId: string; itemId: string }
  | WorkflowStartGitBlockedResult
  | { ok: false; status: 404 | 409 | 422; error: string }

export type ResumeRunResult =
  | { ok: true; runId: string; remediationId: string }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type PreparedImportRunResult =
  | { ok: true; runId: string; itemId: string; warnings: string[] }
  | { ok: false; status: 404 | 409 | 422; error: string }

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
  const meta = resolveWorkspaceMeta(repos, input.workspaceKey)
  if ("error" in meta) return { ok: false, status: 404, error: "unknown_workspace" }

  const io = buildApiIo(repos)
  const prepared = prepareRun(
    { id: "new", title: input.title, description: input.description },
    repos,
    io,
    {
      owner: "api",
      workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      ...meta,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: input.supabaseAdapterFactory,
    },
  )
  const runInBackground = input.backgroundRunner ?? fireInBackground
  runInBackground(io, "startRunFromIdea", prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId }
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

export function isWorkflowStartGitBlockedResult(result: StartRunResult): result is WorkflowStartGitBlockedResult {
  return !result.ok && "code" in result && result.code === "workflow_git_blocked"
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
  action: StartRunAction,
  options: {
    appConfig?: AppConfig
    gitCommandOptions?: GitCommandOptions
  } = {},
): { ok: true; readiness: WorkspaceGitReadiness } | WorkflowStartGitBlockedResult {
  const workspace = repos.getWorkspace(item.workspace_id)
  const intent = { itemId: item.id, action }
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
  error?: StartRunResult
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
  const item = repos.getItem(input.itemId)
  if (!item) return { ok: false, status: 404, error: "item_not_found" }

  const preparedAction = prepareStartRunAction(repos, item, input.action)
  if (preparedAction.error) return preparedAction.error

  const gitGate = checkWorkflowStartGitReadiness(repos, item, input.action, {
    appConfig: input.appConfig,
    gitCommandOptions: input.gitCommandOptions,
  })
  if (!gitGate.ok) return gitGate

  const io = buildApiIo(repos)
  const prepared = prepareRun(
    { id: item.id, title: item.title, description: item.description },
    repos,
    io,
    {
      owner: "api",
      workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      itemId: item.id,
      resume: preparedAction.resume,
      onItemColumnChanged: input.onItemColumnChanged,
      supabaseAdapterFactory: input.supabaseAdapterFactory,
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

  fireInBackground(io, `startRunForItem:${input.action}`, prepared.start)
  return { ok: true, runId: prepared.runId, itemId: item.id }
}

export async function startPreparedImportForItem(
  repos: Repos,
  input: {
    itemId?: string
    sourceDir: string
    workspaceKey?: string
    owner?: "cli" | "api"
    apiWorkerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  },
): Promise<PreparedImportRunResult> {
  const existingItem = input.itemId ? repos.getItem(input.itemId) : undefined
  if (input.itemId && !existingItem) return { ok: false, status: 404, error: "item_not_found" }

  const workspaceResult = resolvePreparedImportWorkspace(repos, existingItem, input.workspaceKey)
  if (!workspaceResult.ok) return workspaceResult.error
  const workspace = workspaceResult.workspace

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

  const io = buildApiIo(repos)
  const resume = {
    scope: { type: "run", runId: "pending" } as const,
    currentStage: "projects",
    projectStartStages: deriveProjectStartStages(bundle),
    dirtyCheckIgnoredPaths: [input.sourceDir],
    skipDesignPrep: true,
  }
  const prepared = prepareRun(
    {
      id: existingItem?.id ?? "new",
      title: existingItem?.title ?? titleForPreparedImportItem(bundle),
      description: existingItem?.description ?? descriptionForPreparedImportItem(bundle),
    },
    repos,
    io,
    {
      owner: input.owner ?? "api",
      workerInstanceId: input.owner === "cli" ? undefined : input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      itemId: existingItem?.id,
      ...newItemWorkspaceFields(existingItem, workspace),
      resume,
      onItemColumnChanged: input.onItemColumnChanged,
    },
  )
  const targetRun = repos.getRun(prepared.runId)
  const item = repos.getItem(prepared.itemId)
  if (!item) return { ok: false, status: 409, error: "seed_failed" }
  const ctx = targetRun ? resolveWorkflowContextForItemRun(repos, item, targetRun) : null
  if (!ctx) return { ok: false, status: 409, error: "seed_failed" }
  const seeded = seedPreparedImportArtifacts(ctx, bundle, { sourceDir: input.sourceDir })
  fireInBackground(io, "startPreparedImportForItem", prepared.start)
  return { ok: true, runId: prepared.runId, itemId: item.id, warnings: seeded.warnings }
}

function resolvePreparedImportWorkspace(
  repos: Repos,
  existingItem: ItemRow | undefined,
  workspaceKey: string | undefined,
): { ok: true; workspace: WorkspaceRow | undefined } | { ok: false; error: PreparedImportRunResult } {
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
  },
): Promise<ResumeRunResult> {
  const summary = input.summary.trim()
  if (!summary) return { ok: false, status: 422, error: "remediation_required" }

  const readiness = await loadResumeReadiness(repos, input.runId)
  if (readiness.kind === "not_found") return { ok: false, status: 404, error: "run_not_found" }
  if (readiness.kind === "no_recovery") return { ok: false, status: 409, error: "not_resumable" }
  if (readiness.kind === "not_resumable") {
    return { ok: false, status: 409, error: readiness.reason }
  }

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

  const io = buildApiIo(repos)
  fireInBackground(io, "resumeRunInProcess", () =>
    performResume({
      repos,
      io,
      runId: input.runId,
      remediation,
      workerOwnerKind: "api",
      workerInstanceId: input.apiWorkerInstanceId ?? API_WORKER_INSTANCE_ID,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      onItemColumnChanged: input.onItemColumnChanged,
    }),
  )
  return { ok: true, runId: input.runId, remediationId: remediation.id }
}

// Re-export the event type for convenience.
export type { WorkflowEvent } from "./runOrchestrator.js"

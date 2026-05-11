import { existsSync } from "node:fs"
import { ask, close } from "../../sim/human.js"
import { createCliIO } from "../../core/ioCli.js"
import type { ItemAction, ItemActionResult } from "../../core/itemActions.js"
import { attachOneShotPromptAnswer } from "../../core/promptAutoAnswer.js"
import { inspectWorkspaceState, resolveDirtyMasterAllowlistPatterns } from "../../core/git.js"
import { layout } from "../../core/workspaceLayout.js"
import {
  checkWorkflowStartGitReadiness,
  checkWorkflowStartGitReadinessForWorkspace,
  isWorkflowCapabilityBlockedResult,
  prepareForegroundItemRun,
  prepareForegroundPreparedImportRun,
  prepareForegroundResumeRun,
  type WorkflowStartGitBlockedResult,
  type StartRunAction,
} from "../../core/runService.js"
import { resolveWorkflowContextForItemRun } from "../../core/workflowContextResolver.js"
import { formatSupabaseReadinessBlockedCliOutput } from "../../core/supabase/preExecutionReadiness.js"
import { parseSupabaseReadinessRecoveryPayload } from "../../core/supabase/recoveryPayload.js"
import type { ItemRow, Repos, RunRow, WorkspaceRow } from "../../db/repositories.js"
import { initDatabase } from "../../db/connection.js"
import type { ResumeFlags } from "../types.js"
import { resolveItemReference, resolveSelectedWorkspace } from "../common.js"
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides } from "../../setup/config.js"
import type { AppConfig } from "../../setup/types.js"

type CliItemActionContext = {
  item: ItemRow
  action: ItemAction
  repos: Repos
  itemRef: string
  appConfig: AppConfig
  resumeFlags?: ResumeFlags
}

type CliItemActionHandler = (ctx: CliItemActionContext) => Promise<number>
type FailedPreparedResumeRunResult = Exclude<
  Awaited<ReturnType<typeof prepareForegroundResumeRun>>,
  { ok: true; runId: string; remediationId: string; start: () => Promise<void> }
>
type FailedPreparedImportRunResult = Exclude<
  Awaited<ReturnType<typeof prepareForegroundPreparedImportRun>>,
  { ok: true; runId: string; itemId: string; warnings: string[]; start: () => Promise<void> }
>
type SuccessfulPreparedImportRunResult = Extract<
  Awaited<ReturnType<typeof prepareForegroundPreparedImportRun>>,
  { ok: true; runId: string; itemId: string; warnings: string[]; start: () => Promise<void> }
>
type PreparedImportCliStart =
  | { ok: true; workspace: WorkspaceRow }
  | { ok: false; exitCode: number }

const CLI_RUN_DEATH_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const

function exitCodeForSignal(signal: string): number {
  if (signal === "SIGINT") return 130
  if (signal === "SIGTERM") return 143
  return 129
}

export function shouldFailCliRunOnProcessExit(
  run: Pick<RunRow, "status" | "owner" | "worker_owner_kind"> | undefined,
): boolean {
  return run?.status === "running" && (run.worker_owner_kind ?? run.owner) === "cli"
}

function toStartRunAction(action: ItemAction): StartRunAction {
  if (
    action === "start_brainstorm"
    || action === "start_visual_companion"
    || action === "start_frontend_design"
    || action === "start_implementation"
    || action === "rerun_design_prep"
  ) {
    return action
  }
  throw new Error(`invalid_start_run_action:${action}`)
}

function installCliRunDeathHandlers(repos: Repos, runId: string): () => void {
  let triggered = false
  const fail = (cause: string): void => {
    if (triggered) return
    triggered = true
    try {
      const run = repos.getRun(runId)
      if (!shouldFailCliRunOnProcessExit(run)) return
      repos.updateRun(runId, {
        status: "failed",
        recovery_status: "failed",
        recovery_scope: "run",
        recovery_scope_ref: null,
        recovery_summary: `CLI worker exited (${cause}) — no live process; resume or abandon.`,
      })
    } catch {
      // best-effort cleanup; suppress so signal handler can finish
    }
  }
  const handlers = CLI_RUN_DEATH_SIGNALS.map(signal => {
    const handler = (): void => {
      fail(signal)
      process.exit(exitCodeForSignal(signal))
    }
    process.on(signal, handler)
    return { signal, handler }
  })
  const beforeExit = (): void => fail("beforeExit")
  process.on("beforeExit", beforeExit)
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler)
    process.off("beforeExit", beforeExit)
  }
}

type ItemActionsModule = typeof import("../../core/itemActions.js")
let lookupTransitionSync: ItemActionsModule["lookupTransition"]
let createItemActionsService: ItemActionsModule["createItemActionsService"]

async function collectRemediationFlags(flags: ResumeFlags, interactive: boolean): Promise<ResumeFlags | null> {
  const out: ResumeFlags = { ...flags }
  if (interactive && !out.summary) {
    try {
      out.summary = (await ask("  Remediation summary (required): ")).trim() || undefined
      if (!out.branch) out.branch = (await ask("  Branch (optional):            ")).trim() || undefined
      if (!out.notes) out.notes = (await ask("  Review notes (optional):      ")).trim() || undefined
    } finally {
      close()
    }
  }
  if (!out.summary) return null
  return out
}

function printResumeBlockedOutput(
  runId: string,
  recovery: { summary: string | null; scope: string | null; scopeRef: string | null },
  itemRef: string,
): void {
  const scopeDetail = recovery.scopeRef ? ` (${recovery.scopeRef})` : ""
  console.error(`\n  Run ${runId} is blocked.`)
  if (recovery.summary) console.error(`  Reason: ${recovery.summary}`)
  if (recovery.scope) console.error(`  Scope:  ${recovery.scope}${scopeDetail}`)
  console.error(
    `  Resume with: beerengineer item action --item ${itemRef} --action resume_run --remediation-summary "<what you fixed>"`,
  )
}

async function collectResumePayload(
  active: ReturnType<Repos["latestActiveRunForItem"]>,
  resumeFlags: ResumeFlags | undefined,
  itemRef: string,
): Promise<
  | { kind: "continue"; payload?: { summary: string; branch?: string; commitSha?: string; reviewNotes?: string } }
  | { kind: "exit"; code: number }
> {
  if (!active?.recovery_status) return { kind: "continue" }
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY) && resumeFlags?.yes !== true
  const collected = await collectRemediationFlags(resumeFlags ?? {}, isTty)
  if (!collected?.summary) {
    printResumeBlockedOutput(active.id, {
      summary: active.recovery_summary,
      scope: active.recovery_scope,
      scopeRef: active.recovery_scope_ref,
    }, itemRef)
    console.error("  Missing --remediation-summary (required for non-interactive resume).")
    return { kind: "exit", code: 75 }
  }
  return {
    kind: "continue",
    payload: {
      summary: collected.summary,
      branch: collected.branch,
      commitSha: collected.commit,
      reviewNotes: collected.notes,
    },
  }
}

function printDirtyRepoPreflight(rootPath: string, ignoredPaths: string[] = []): number {
  const inspection = inspectWorkspaceState(rootPath, {
    ignoredPaths,
    allowlistPatterns: resolveDirtyMasterAllowlistPatterns(rootPath),
  })
  if (inspection.kind !== "dirty") return 0

  const onBaseBranch = inspection.currentBranch === "main" || inspection.currentBranch === "master"
  const total = inspection.trackedCount + inspection.untrackedCount

  console.error("  Git preflight failed: workspace repo is dirty.")
  console.error(`  Root:   ${rootPath}`)
  console.error(`  Branch: ${inspection.currentBranch || "<unknown>"}`)
  console.error(`  Changed files: ${total} (${inspection.trackedCount} tracked, ${inspection.untrackedCount} untracked)`)
  if (onBaseBranch) {
    console.error("  Strategy violation: uncommitted work is sitting on main/master.")
    console.error("  beerengineer_ expects main/master to stay clean; item work must happen on item/* branches.")
  } else {
    console.error("  beerengineer_ requires a clean repo before starting a new item branch.")
  }
  console.error("  Next steps: git status")
  console.error("             git add -A && git commit -m \"...\"")
  console.error("             git stash push -u")
  return 73
}

function preflightCliBranchingStart(repos: Repos, workspaceId: string, ignoredPaths: string[] = []): number {
  const workspace = repos.getWorkspace(workspaceId)
  const rootPath = workspace?.root_path?.trim()
  if (!rootPath) return 0
  return printDirtyRepoPreflight(rootPath, ignoredPaths)
}

function printWorkflowGitBlocker(blocker: WorkflowStartGitBlockedResult, itemRef: string): number {
  console.error("\n  Workflow start blocked by Git readiness.")
  console.error(`  Reason: ${blocker.message}`)
  if (blocker.readiness?.workspace.key) console.error(`  Workspace: ${blocker.readiness.workspace.key}`)
  if (blocker.error === "git_not_installed") {
    console.error("  Next steps: install Git, then retry the same item action.")
    return 75
  }
  if (blocker.error === "git_identity_missing") {
    console.error("  Repair options:")
    if (blocker.repair?.appDefaultIdentityAvailable) {
      console.error("    - Open `beerengineer setup` and apply the saved app-level identity to this workspace.")
    } else {
      console.error("    - Open `beerengineer setup` and save a Git identity default, then apply it to this workspace.")
    }
    console.error("    - Or run `git config --local user.name \"Your Name\"` and `git config --local user.email \"you@example.com\"` in the workspace.")
    console.error(`  Retry: beerengineer item action --item ${itemRef} --action ${blocker.intent.action}`)
    return 75
  }
  console.error("  Next steps: reconnect the registered workspace or choose a Git repository, then retry the item action.")
  return 75
}

function printWorkflowCapabilityBlocker(message: string): number {
  console.error("\n  Workflow capability ownership blocked the requested action.")
  console.error(`  Reason: ${message}`)
  return 75
}

function printPreparedResumeFailure(result: FailedPreparedResumeRunResult): number {
  if (isWorkflowCapabilityBlockedResult(result)) {
    return printWorkflowCapabilityBlocker(result.message)
  }
  if (result.error === "resume_in_progress" || result.error === "not_resumable") {
    console.error(`  Not resumable: ${result.error}`)
    return 2
  }
  if (result.error === "remediation_required") {
    console.error("  Missing remediation summary (pass --remediation-summary).")
    return 75
  }
  console.error(`  ${result.error}`)
  return 1
}

function printSupabaseStartBlockerIfAny(
  repos: Repos,
  runId: string,
  itemRef: string,
  action: string,
): number {
  const run = repos.getRun(runId)
  if (run?.recovery_status !== "blocked") return 0
  const payload = parseSupabaseReadinessRecoveryPayload(run.recovery_payload_json)
  if (!payload) return 0
  const workspace = repos.getWorkspace(run.workspace_id)
  console.error(formatSupabaseReadinessBlockedCliOutput({
    itemRef,
    action,
    runId,
    readiness: {
      ...payload,
      status: "blocked",
      retry: { ...payload.retry, runId: payload.retry.runId ?? runId },
      workspace: {
        ...payload.workspace,
        id: payload.workspace.id ?? workspace?.id,
        key: payload.workspace.key ?? workspace?.key,
      },
    },
  }))
  return 75
}

function hasStageArtifacts(repos: Repos, item: Pick<ItemRow, "workspace_id">, runId: string, stageId: string): boolean {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForItemRun(repos, item, run) : null
  return ctx ? existsSync(layout.stageDir(ctx, stageId)) : false
}

function latestRunWithStageArtifacts(
  repos: Repos,
  item: Pick<ItemRow, "id" | "workspace_id">,
  stageId: string,
): { id: string } | undefined {
  return repos
    .listRuns()
    .filter(run => run.item_id === item.id)
    .sort((a, b) => b.created_at - a.created_at)
    .find(run => hasStageArtifacts(repos, item, run.id, stageId))
}

function startRunPrelude(ctx: CliItemActionContext): number {
  const action = toStartRunAction(ctx.action)
  const transition = lookupTransitionSync(ctx.action, ctx.item.current_column, ctx.item.phase_status)
  if (transition.kind !== "start-run") {
    console.error(`  Invalid transition: ${ctx.action} from ${ctx.item.current_column}/${ctx.item.phase_status}`)
    return 1
  }
  const gitGate = checkWorkflowStartGitReadiness(ctx.repos, ctx.item, action, {
    appConfig: ctx.appConfig,
  })
  if (!gitGate.ok) return printWorkflowGitBlocker(gitGate, ctx.itemRef)
  return preflightCliBranchingStart(ctx.repos, ctx.item.workspace_id)
}

function printBlockedResumeIfAny(ctx: CliItemActionContext, runId: string): number {
  const refreshed = ctx.repos.getRun(runId)
  if (refreshed?.recovery_status !== "blocked") return 0

  const supabaseBlockedExit = printSupabaseStartBlockerIfAny(ctx.repos, runId, ctx.itemRef, ctx.action)
  if (supabaseBlockedExit !== 0) return supabaseBlockedExit

  printResumeBlockedOutput(runId, {
    summary: refreshed.recovery_summary,
    scope: refreshed.recovery_scope,
    scopeRef: refreshed.recovery_scope_ref,
  }, ctx.itemRef)
  return 0
}

const handleStartBrainstorm: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const action = toStartRunAction(ctx.action)
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareForegroundItemRun(ctx.repos, io, {
      itemId: ctx.item.id,
      action,
      owner: "cli",
      appConfig: ctx.appConfig,
    })
    if (!prepared.ok) {
      if (isWorkflowCapabilityBlockedResult(prepared)) {
        return printWorkflowCapabilityBlocker(prepared.message)
      }
      console.error(`  ${prepared.error}`)
      return 1
    }
    await prepared.start()
    const blockedExit = printSupabaseStartBlockerIfAny(ctx.repos, prepared.runId, ctx.itemRef, ctx.action)
    if (blockedExit !== 0) return blockedExit
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartImplementationOrRerunDesignPrep: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const action = toStartRunAction(ctx.action)
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start implementation: no prior brainstorm artifacts found for this item.")
    console.error("  Run start_brainstorm first, then retry start_implementation.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareForegroundItemRun(ctx.repos, io, {
      itemId: ctx.item.id,
      action,
      owner: "cli",
      appConfig: ctx.appConfig,
    })
    if (!prepared.ok) {
      if (isWorkflowCapabilityBlockedResult(prepared)) {
        return printWorkflowCapabilityBlocker(prepared.message)
      }
      console.error(`  ${prepared.error}`)
      return 1
    }
    await prepared.start()
    const blockedExit = printSupabaseStartBlockerIfAny(ctx.repos, prepared.runId, ctx.itemRef, ctx.action)
    if (blockedExit !== 0) return blockedExit
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartVisualCompanion: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const action = toStartRunAction(ctx.action)
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start visual-companion: no prior brainstorm artifacts found.")
    console.error("  Run start_brainstorm first, then retry start_visual_companion.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareForegroundItemRun(ctx.repos, io, {
      itemId: ctx.item.id,
      action,
      owner: "cli",
      appConfig: ctx.appConfig,
    })
    if (!prepared.ok) {
      if (isWorkflowCapabilityBlockedResult(prepared)) {
        return printWorkflowCapabilityBlocker(prepared.message)
      }
      console.error(`  ${prepared.error}`)
      return 1
    }
    await prepared.start()
    const blockedExit = printSupabaseStartBlockerIfAny(ctx.repos, prepared.runId, ctx.itemRef, ctx.action)
    if (blockedExit !== 0) return blockedExit
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartFrontendDesign: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const action = toStartRunAction(ctx.action)
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "visual-companion")
  if (!sourceRun) {
    console.error("  Cannot start frontend-design: no prior visual-companion artifacts found.")
    console.error("  Run start_visual_companion first, then retry start_frontend_design.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareForegroundItemRun(ctx.repos, io, {
      itemId: ctx.item.id,
      action,
      owner: "cli",
      appConfig: ctx.appConfig,
    })
    if (!prepared.ok) {
      if (isWorkflowCapabilityBlockedResult(prepared)) {
        return printWorkflowCapabilityBlocker(prepared.message)
      }
      console.error(`  ${prepared.error}`)
      return 1
    }
    await prepared.start()
    const blockedExit = printSupabaseStartBlockerIfAny(ctx.repos, prepared.runId, ctx.itemRef, ctx.action)
    if (blockedExit !== 0) return blockedExit
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleResumeRun: CliItemActionHandler = async ctx => {
  const active =
    ctx.repos.latestActiveRunForItem(ctx.item.id) ?? ctx.repos.latestRecoverableRunForItem(ctx.item.id)
  const resumeRunId = active?.id
  const resumePayloadResult = await collectResumePayload(active, ctx.resumeFlags, ctx.itemRef)
  if (resumePayloadResult.kind === "exit") return resumePayloadResult.code
  const resumePayload = resumePayloadResult.payload

  if (resumePayload && resumeRunId) {
    const io = createCliIO(ctx.repos)
    try {
      const prepared = await prepareForegroundResumeRun(ctx.repos, io, {
        runId: resumeRunId,
        summary: resumePayload.summary,
        branch: resumePayload.branch,
        commit: resumePayload.commitSha,
        reviewNotes: resumePayload.reviewNotes,
        workerOwnerKind: "cli",
      })
      if (!prepared.ok) return printPreparedResumeFailure(prepared)
      console.log(`  ${ctx.action} applied`)
      console.log(`  run-id: ${prepared.runId}`)
      console.log(`  remediation-id: ${prepared.remediationId}`)
      await prepared.start()
      const blockedExit = printBlockedResumeIfAny(ctx, prepared.runId)
      if (blockedExit !== 0) return blockedExit
      return 0
    } finally {
      io.close?.()
    }
  }

  return runDefaultItemAction(ctx, resumePayload)
}

async function resumeItemActionResult(
  ctx: CliItemActionContext,
  result: Extract<ItemActionResult, { ok: true; kind: "resume_run" }>,
): Promise<number> {
  const { loadResumeReadiness, performResume } = await import("../../core/resume.js")
  const readiness = await loadResumeReadiness(ctx.repos, result.runId)
  if (readiness.kind === "not_found") {
    console.error(`  Item not found: ${ctx.itemRef}`)
    return 1
  }
  if (readiness.kind === "not_resumable") {
    console.error(`  Not resumable: ${readiness.reason}`)
    return 2
  }
  if (readiness.kind === "no_recovery") {
    console.error(`  Invalid transition: ${ctx.action} from ${ctx.item.current_column}/${ctx.item.phase_status}`)
    return 1
  }

  let scopeRef: string | null = null
  if (readiness.record.scope.type === "stage") scopeRef = readiness.record.scope.stageId
  else if (readiness.record.scope.type === "story") scopeRef = `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
  const remediation = ctx.repos.createExternalRemediation({
    runId: result.runId,
    scope: readiness.record.scope.type,
    scopeRef,
    summary: result.summary,
    branch: result.branch,
    reviewNotes: result.reviewNotes,
    source: "cli",
  })

  const io = createCliIO(ctx.repos, { externalPromptResolver: Boolean(result.promptAnswer) })
  const detachPromptAnswer = result.promptAnswer ? attachOneShotPromptAnswer(io, result.promptAnswer) : () => {}
  try {
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${result.runId}`)
    console.log(`  remediation-id: ${remediation.id}`)
    await performResume({
      repos: ctx.repos,
      io,
      runId: result.runId,
      remediation,
      workerOwnerKind: "cli",
    })
    const refreshed = ctx.repos.getRun(result.runId)
    if (refreshed?.recovery_status === "blocked") {
      const supabaseBlockedExit = printSupabaseStartBlockerIfAny(ctx.repos, result.runId, ctx.itemRef, ctx.action)
      if (supabaseBlockedExit !== 0) return supabaseBlockedExit
      printResumeBlockedOutput(result.runId, {
        summary: refreshed.recovery_summary,
        scope: refreshed.recovery_scope,
        scopeRef: refreshed.recovery_scope_ref,
      }, ctx.itemRef)
    }
    return 0
  } finally {
    detachPromptAnswer()
    io.close?.()
  }
}

async function runDefaultItemAction(
  ctx: CliItemActionContext,
  resumePayload?: { summary: string; branch?: string; commitSha?: string; reviewNotes?: string },
): Promise<number> {
  const service = createItemActionsService(ctx.repos)
  try {
    const result = await service.perform(
      ctx.item.id,
      ctx.action,
      resumePayload ? { resume: resumePayload } : undefined,
    )
    if (!result.ok) {
      if (result.status === 404) console.error(`  Item not found: ${ctx.itemRef}`)
      else if (result.status === 422) {
        console.error("  Missing remediation summary (pass --remediation-summary).")
        return 75
      } else if (result.error === "not_resumable" || result.error === "resume_in_progress") {
        console.error(`  Not resumable: ${result.error}`)
        return 2
      } else {
        console.error(`  Invalid transition: ${result.action} from ${result.current.column}/${result.current.phaseStatus}`)
      }
      return 1
    }
    if (result.kind === "resume_run") return resumeItemActionResult(ctx, result)
    console.log(`  ${ctx.action} applied`)
    if (result.kind === "needs_spawn" && result.runId) console.log(`  run-id: ${result.runId}`)
    if (result.kind === "needs_spawn" && result.remediationId) console.log(`  remediation-id: ${result.remediationId}`)
    if (result.kind === "needs_spawn" && result.runId) {
      const refreshed = ctx.repos.getRun(result.runId)
      if (refreshed?.recovery_status === "blocked") {
        printResumeBlockedOutput(result.runId, {
          summary: refreshed.recovery_summary,
          scope: refreshed.recovery_scope,
          scopeRef: refreshed.recovery_scope_ref,
        }, ctx.itemRef)
      }
    }
    return 0
  } finally {
    service.dispose()
  }
}

const CLI_ITEM_ACTION_HANDLERS: Partial<Record<ItemAction, CliItemActionHandler>> = {
  start_brainstorm: handleStartBrainstorm,
  start_visual_companion: handleStartVisualCompanion,
  start_frontend_design: handleStartFrontendDesign,
  start_implementation: handleStartImplementationOrRerunDesignPrep,
  rerun_design_prep: handleStartImplementationOrRerunDesignPrep,
  resume_run: handleResumeRun,
}

async function startPreparedImportFromCli(
  repos: Repos,
  item: ItemRow | undefined,
  sourceDir: string,
  workspaceKey: string | undefined,
  appConfig: AppConfig,
  json: boolean,
): Promise<number> {
  const start = preparePreparedImportCliStart(repos, item, sourceDir, workspaceKey, appConfig)
  if (!start.ok) return start.exitCode
  const io = createCliIO(repos)
  try {
    const prepared = await prepareForegroundPreparedImportRun(repos, io, {
      itemId: item?.id,
      sourceDir,
      workspaceKey: item ? undefined : start.workspace.key,
      owner: "cli",
      appConfig,
    })
    if (!prepared.ok) return reportPreparedImportFailure(prepared, item)
    await startPreparedImportRun(repos, prepared)
    printPreparedImportStartOutput(prepared, json)
    return 0
  } finally {
    io.close?.()
  }
}

function preparePreparedImportCliStart(
  repos: Repos,
  item: ItemRow | undefined,
  sourceDir: string,
  workspaceKey: string | undefined,
  appConfig: AppConfig,
): PreparedImportCliStart {
  const workspace = item ? repos.getWorkspace(item.workspace_id) : resolveSelectedWorkspace(repos, workspaceKey)
  if (!workspace) return { ok: false, exitCode: reportMissingPreparedImportWorkspace(workspaceKey) }

  const transitionExit = validatePreparedImportTransition(item)
  if (transitionExit !== 0) return { ok: false, exitCode: transitionExit }

  const gitGate = checkWorkflowStartGitReadinessForWorkspace(
    workspace,
    { itemId: item?.id ?? "new", action: "import_prepared" },
    { appConfig },
  )
  if (!gitGate.ok) {
    return { ok: false, exitCode: printWorkflowGitBlocker(gitGate, item?.code ?? item?.id ?? "new") }
  }

  const exit = preflightCliBranchingStart(repos, workspace.id, [sourceDir])
  if (exit !== 0) return { ok: false, exitCode: exit }
  return { ok: true, workspace }
}

function reportPreparedImportFailure(prepared: FailedPreparedImportRunResult, item: ItemRow | undefined): number {
  if (isWorkflowCapabilityBlockedResult(prepared)) {
    return printWorkflowCapabilityBlocker(prepared.message)
  }
  if ("code" in prepared && prepared.code === "workflow_git_blocked") {
    return printWorkflowGitBlocker(prepared, item?.code ?? item?.id ?? "new")
  }
  console.error(`  Import failed: ${prepared.error}`)
  return 1
}

async function startPreparedImportRun(repos: Repos, prepared: SuccessfulPreparedImportRunResult): Promise<void> {
  repos.setItemColumn(prepared.itemId, "implementation", "running")
  const releaseDeathHandlers = installCliRunDeathHandlers(repos, prepared.runId)
  try {
    await prepared.start()
  } finally {
    releaseDeathHandlers()
  }
}

function printPreparedImportStartOutput(prepared: SuccessfulPreparedImportRunResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ kind: "started", itemId: prepared.itemId, runId: prepared.runId, warnings: prepared.warnings }))
    return
  }
  console.log("  import_prepared applied")
  console.log(`  item-id: ${prepared.itemId}`)
  console.log(`  run-id: ${prepared.runId}`)
  for (const warning of prepared.warnings) console.log(`  warning: ${warning}`)
}

function reportMissingPreparedImportWorkspace(workspaceKey: string | undefined): number {
  console.error(workspaceKey ? `  Unknown workspace: ${workspaceKey}` : "  No workspace configured. Use `beerengineer workspace add` first.")
  return 1
}

function validatePreparedImportTransition(item: ItemRow | undefined): number {
  if (item === undefined) return 0
  const transition = lookupTransitionSync("import_prepared", item.current_column, item.phase_status)
  if (transition.kind === "start-run") return 0
  console.error(`  Invalid transition: import_prepared from ${item.current_column}/${item.phase_status}`)
  return 1
}

function loadCliAppConfig(): AppConfig {
  const overrides = resolveOverrides()
  return resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides) ?? defaultAppConfig()
}

export async function runItemImportPrepared(itemRef: string | undefined, sourceDir: string | undefined, workspaceKey?: string, json = false): Promise<number> {
  if (!sourceDir) {
    console.error("  Usage: beerengineer item import-prepared [item] --from <dir>")
    return 1
  }
  const itemActions = await import("../../core/itemActions.js")
  lookupTransitionSync = itemActions.lookupTransition
  const db = initDatabase()
  const repos = new (await import("../../db/repositories.js")).Repos(db)
  const appConfig = loadCliAppConfig()
  try {
    if (!itemRef) return await startPreparedImportFromCli(repos, undefined, sourceDir, workspaceKey, appConfig, json)
    const resolvedWorkspace = workspaceKey ? undefined : repos.getWorkspaceByKey(itemRef)
    const resolved = resolveItemReference(repos, itemRef)
    if (resolved.kind === "found") {
      return await startPreparedImportFromCli(repos, resolved.item, sourceDir, workspaceKey, appConfig, json)
    }
    if (resolved.kind === "missing" && resolvedWorkspace) {
      return await startPreparedImportFromCli(repos, undefined, sourceDir, resolvedWorkspace.key, appConfig, json)
    }
    if (resolved.kind === "missing") {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    console.error(`  Ambiguous item code: ${itemRef}`)
    resolved.matches.forEach(match => console.error(`    ${match.id}`))
    return 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) console.error(JSON.stringify({ error: message }))
    else console.error(`  Import failed: ${message}`)
    return 1
  } finally {
    db.close()
  }
}

export async function runItemAction(itemRef: string, action: string, resumeFlags?: ResumeFlags): Promise<number> {
  const itemActions = await import("../../core/itemActions.js")
  if (!itemActions.isItemAction(action)) {
    console.error(`  Unknown action: ${action}`)
    return 1
  }
  lookupTransitionSync = itemActions.lookupTransition
  createItemActionsService = itemActions.createItemActionsService
  const db = initDatabase()
  const repos = new (await import("../../db/repositories.js")).Repos(db)
  const appConfig = loadCliAppConfig()
  try {
    const resolved = resolveItemReference(repos, itemRef)
    if (resolved.kind === "missing") {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    if (resolved.kind === "ambiguous") {
      console.error(`  Ambiguous item code: ${itemRef}`)
      console.error("  Matching item ids:")
      resolved.matches.forEach(match => console.error(`    ${match.id}`))
      return 1
    }
    const ctx: CliItemActionContext = {
      item: resolved.item,
      action,
      repos,
      itemRef,
      appConfig,
      resumeFlags,
    }
    const handler = CLI_ITEM_ACTION_HANDLERS[action] ?? runDefaultItemAction
    return await handler(ctx)
  } finally {
    db.close()
  }
}

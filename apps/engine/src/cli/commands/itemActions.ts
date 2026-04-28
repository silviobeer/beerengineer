import { cpSync, existsSync } from "node:fs"
import { ask, close } from "../../sim/human.js"
import { createCliIO } from "../../core/ioCli.js"
import type { ItemAction } from "../../core/itemActions.js"
import { inspectWorkspaceState } from "../../core/git.js"
import { layout } from "../../core/workspaceLayout.js"
import { prepareRun, runWorkflowWithSync } from "../../core/runOrchestrator.js"
import { resolveWorkflowContextForItemRun } from "../../core/workflowContextResolver.js"
import type { ItemRow, Repos } from "../../db/repositories.js"
import { initDatabase } from "../../db/connection.js"
import type { ResumeFlags } from "../types.js"
import { resolveItemReference } from "../common.js"

type CliItemActionContext = {
  item: ItemRow
  action: ItemAction
  repos: Repos
  itemRef: string
  resumeFlags?: ResumeFlags
}

type CliItemActionHandler = (ctx: CliItemActionContext) => Promise<number>

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

function printDirtyRepoPreflight(rootPath: string): number {
  const inspection = inspectWorkspaceState(rootPath)
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

function preflightCliBranchingStart(repos: Repos, workspaceId: string): number {
  const workspace = repos.getWorkspace(workspaceId)
  const rootPath = workspace?.root_path?.trim()
  if (!rootPath) return 0
  return printDirtyRepoPreflight(rootPath)
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

function seedStageFromPreviousRun(repos: Repos, item: ItemRow, sourceRunId: string, targetRunId: string, stageId: string): boolean {
  const sourceRun = repos.getRun(sourceRunId)
  const targetRun = repos.getRun(targetRunId)
  const sourceCtx = sourceRun ? resolveWorkflowContextForItemRun(repos, item, sourceRun) : null
  const targetCtx = targetRun ? resolveWorkflowContextForItemRun(repos, item, targetRun) : null
  if (!sourceCtx || !targetCtx) return false
  const sourceStageDir = layout.stageDir(sourceCtx, stageId)
  if (!existsSync(sourceStageDir)) return false
  cpSync(sourceStageDir, layout.stageDir(targetCtx, stageId), { recursive: true })
  return true
}

function startRunPrelude(ctx: CliItemActionContext): number {
  const transition = lookupTransitionSync(ctx.action, ctx.item.current_column, ctx.item.phase_status)
  if (transition.kind !== "start-run") {
    console.error(`  Invalid transition: ${ctx.action} from ${ctx.item.current_column}/${ctx.item.phase_status}`)
    return 1
  }
  return preflightCliBranchingStart(ctx.repos, ctx.item.workspace_id)
}

const handleStartBrainstorm: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const io = createCliIO(ctx.repos)
  try {
    const runId = await runWorkflowWithSync(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      { owner: "cli", itemId: ctx.item.id },
    )
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartImplementationOrRerunDesignPrep: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start implementation: no prior brainstorm artifacts found for this item.")
    console.error("  Run start_brainstorm first, then retry start_implementation.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: ctx.action === "rerun_design_prep" ? "visual-companion" : "projects",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start implementation: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "visual-companion")
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "frontend-design")
    await prepared.start()
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
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start visual-companion: no prior brainstorm artifacts found.")
    console.error("  Run start_brainstorm first, then retry start_visual_companion.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: "visual-companion",
          manualStage: "visual-companion",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start visual-companion: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    await prepared.start()
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
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "visual-companion")
  if (!sourceRun) {
    console.error("  Cannot start frontend-design: no prior visual-companion artifacts found.")
    console.error("  Run start_visual_companion first, then retry start_frontend_design.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: "frontend-design",
          manualStage: "frontend-design",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start frontend-design: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "visual-companion")
    await prepared.start()
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
    const { loadResumeReadiness, performResume } = await import("../../core/resume.js")
    const readiness = await loadResumeReadiness(ctx.repos, resumeRunId)
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
      runId: resumeRunId,
      scope: readiness.record.scope.type,
      scopeRef,
      summary: resumePayload.summary,
      branch: resumePayload.branch,
      commitSha: resumePayload.commitSha,
      reviewNotes: resumePayload.reviewNotes,
      source: "cli",
    })

    const io = createCliIO(ctx.repos)
    try {
      console.log(`  ${ctx.action} applied`)
      console.log(`  run-id: ${resumeRunId}`)
      console.log(`  remediation-id: ${remediation.id}`)
      await performResume({ repos: ctx.repos, io, runId: resumeRunId, remediation })
      const refreshed = ctx.repos.getRun(resumeRunId)
      if (refreshed?.recovery_status === "blocked") {
        printResumeBlockedOutput(resumeRunId, {
          summary: refreshed.recovery_summary,
          scope: refreshed.recovery_scope,
          scopeRef: refreshed.recovery_scope_ref,
        }, ctx.itemRef)
      }
      return 0
    } finally {
      io.close?.()
    }
  }

  return runDefaultItemAction(ctx, resumePayload)
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
      resumeFlags,
    }
    const handler = CLI_ITEM_ACTION_HANDLERS[action] ?? runDefaultItemAction
    return await handler(ctx)
  } finally {
    db.close()
  }
}

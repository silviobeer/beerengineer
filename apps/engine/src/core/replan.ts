import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { renderPlanMarkdown } from "../render/plan.js"
import type { Repos, RunRow } from "../db/repositories.js"
import type { WorkflowIO } from "./io.js"
import type { ArchitectureArtifact, ImplementationPlanArtifact, PRD, Project, WithArchitecture } from "../types.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"
import { projectPrdFileName } from "./preparedImport.js"
import { requireWorkflowContextForRun } from "./workflowContextResolver.js"
import { planning } from "../stages/planning/index.js"
import type { RunLlmConfig } from "../llm/registry.js"

export type PlanRevisionWaveSummary = {
  id: string
  logicalId: string
  number: number
  kind: "setup" | "feature"
  goal: string
  storyIds: string[]
  dbRelevantWave: boolean
}

export type PlanRevisionSummary = {
  planId: string
  version: number
  generatedAt: string
  summary: string
  waveCount: number
  waves: PlanRevisionWaveSummary[]
}

export type PlanArchiveAction = {
  kind: "planning-json" | "planning-markdown" | "execution-waves" | "handoffs" | "supabase-handoff"
  action: "copied" | "moved"
  sourcePath: string
  archivedPath: string
}

export type PlanRecoveryTransition = {
  before: {
    status: RunRow["recovery_status"]
    scope: RunRow["recovery_scope"]
    scopeRef: string | null
    payloadJson: string | null
  }
  after: {
    status: RunRow["recovery_status"]
    scope: RunRow["recovery_scope"]
    scopeRef: string | null
    payloadJson: string | null
  }
}

export type PlanRegenerationRecord = {
  operationId: string
  reason: string
  generatedAt: string
  before: PlanRevisionSummary
  after: PlanRevisionSummary
  archivedArtifacts: PlanArchiveAction[]
  recoveryTransition: PlanRecoveryTransition
}

export type PersistedImplementationPlanArtifact = ImplementationPlanArtifact & {
  metadata: {
    activePlan: PlanRevisionSummary
    history: PlanRegenerationRecord[]
  }
}

export type PerformExplicitReplanInput = {
  repos: Repos
  io?: WorkflowIO
  runId: string
  reason: string
  generatePlan: (currentPlan: PersistedImplementationPlanArtifact) => Promise<ImplementationPlanArtifact> | ImplementationPlanArtifact
  hooks?: {
    afterPreparation?: () => Promise<void> | void
  }
}

export type GenerateReplacementPlanFromArtifactsInput = {
  repos: Repos
  runId: string
  llm?: RunLlmConfig
}

type PreparedReplanActivation = {
  operationId: string
  before: PlanRevisionSummary
  after: PlanRevisionSummary
  tempRoot: string
  finalRoot: string
  stagedPlanJsonPath: string
  stagedPlanMarkdownPath: string
  stagedAuditJsonPath: string
  stagedAuditMarkdownPath: string
  archivedArtifacts: PlanArchiveAction[]
  recoveryTransition: PlanRecoveryTransition
}

function nowIso(): string {
  return new Date().toISOString()
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readPersistedPlan(path: string): Promise<PersistedImplementationPlanArtifact> {
  const raw = await readFile(path, "utf8")
  const parsed = JSON.parse(raw) as ImplementationPlanArtifact & {
    metadata?: Partial<PersistedImplementationPlanArtifact["metadata"]>
  }
  return applyPersistedMetadata(parsed)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

async function loadProjectForPlan(ctx: WorkflowContext, projectId: string): Promise<Project> {
  const projects = await readJson<Project[]>(join(layout.stageArtifactsDir(ctx, "brainstorm"), "projects.json"))
  const project = projects.find(candidate => candidate.id === projectId)
  if (!project) throw new Error(`replan_project_not_found:${projectId}`)
  return project
}

async function loadPrdForPlan(ctx: WorkflowContext, projectId: string): Promise<PRD> {
  const requirementsDir = layout.stageArtifactsDir(ctx, "requirements")
  const projectScopedPath = join(requirementsDir, projectPrdFileName(projectId))
  if (await pathExists(projectScopedPath)) {
    return (await readJson<{ prd: PRD }>(projectScopedPath)).prd
  }
  return (await readJson<{ prd: PRD }>(join(requirementsDir, "prd.json"))).prd
}

async function loadArchitectureForPlan(ctx: WorkflowContext): Promise<ArchitectureArtifact> {
  return await readJson<ArchitectureArtifact>(
    join(layout.stageArtifactsDir(ctx, "architecture"), "architecture.json"),
  )
}

function applyPersistedMetadata(
  artifact: ImplementationPlanArtifact & {
    metadata?: Partial<PersistedImplementationPlanArtifact["metadata"]>
  },
): PersistedImplementationPlanArtifact {
  const generatedAt = nowIso()
  const activePlan = artifact.metadata?.activePlan ?? summarizePlan({
    artifact,
    version: 1,
    planId: "plan-v1",
    generatedAt,
  })
  const history = Array.isArray(artifact.metadata?.history) ? artifact.metadata.history : []
  return {
    ...artifact,
    metadata: {
      activePlan,
      history,
    },
  }
}

function summarizePlan(input: {
  artifact: ImplementationPlanArtifact
  version: number
  planId: string
  generatedAt: string
  logicalIdsByActiveId?: Map<string, string>
}): PlanRevisionSummary {
  const waves = Array.isArray(input.artifact.plan?.waves) ? input.artifact.plan.waves : []
  return {
    planId: input.planId,
    version: input.version,
    generatedAt: input.generatedAt,
    summary: input.artifact.plan?.summary ?? "",
    waveCount: waves.length,
    waves: waves.map(wave => ({
      id: wave.id,
      logicalId: input.logicalIdsByActiveId?.get(wave.id) ?? wave.id,
      number: wave.number,
      kind: wave.kind === "setup" ? "setup" : "feature",
      goal: wave.goal,
      storyIds: Array.isArray(wave.stories) ? wave.stories.map(story => story.id) : [],
      dbRelevantWave: wave.dbRelevantWave === true,
    })),
  }
}

function namespaceReplacementPlan(
  replacement: ImplementationPlanArtifact,
  version: number,
  generatedAt: string,
): { artifact: PersistedImplementationPlanArtifact; summary: PlanRevisionSummary } {
  const waves = Array.isArray(replacement.plan?.waves) ? replacement.plan.waves : []
  const idMap = new Map<string, string>()
  const logicalIdsByActiveId = new Map<string, string>()
  for (const wave of waves) {
    const activeId = `${wave.id}--r${version}`
    idMap.set(wave.id, activeId)
    logicalIdsByActiveId.set(activeId, wave.id)
  }
  const renamed: ImplementationPlanArtifact = {
    ...replacement,
    plan: {
      ...replacement.plan,
      waves: waves.map(wave => ({
        ...wave,
        id: idMap.get(wave.id) ?? wave.id,
        dependencies: Array.isArray(wave.dependencies)
          ? wave.dependencies.map(dep => idMap.get(dep) ?? dep)
          : [],
      })),
    },
  }
  const summary = summarizePlan({
    artifact: renamed,
    version,
    planId: `plan-v${version}`,
    generatedAt,
    logicalIdsByActiveId,
  })
  return {
    artifact: {
      ...renamed,
      metadata: {
        activePlan: summary,
        history: [],
      },
    },
    summary,
  }
}

function planMarkdownArchiveLabel(version: number): string {
  return `Archived Implementation Plan Markdown (plan-v${version})`
}

function planJsonArchiveLabel(version: number): string {
  return `Archived Implementation Plan JSON (plan-v${version})`
}

function formatWaveList(waves: PlanRevisionWaveSummary[]): string {
  return waves.map(wave => `${wave.number}:${wave.id}`).join(", ")
}

function auditMarkdown(record: PlanRegenerationRecord): string {
  return [
    "# Plan Regeneration Audit",
    "",
    `- Operation: ${record.operationId}`,
    `- Reason: ${record.reason}`,
    `- Generated At: ${record.generatedAt}`,
    "",
    "## Before",
    `- Plan: ${record.before.planId}`,
    `- Waves: ${formatWaveList(record.before.waves)}`,
    "",
    "## After",
    `- Plan: ${record.after.planId}`,
    `- Waves: ${formatWaveList(record.after.waves)}`,
    "",
    "## Archived Artifacts",
    ...record.archivedArtifacts.map(artifact => `- ${artifact.kind}: ${artifact.sourcePath} -> ${artifact.archivedPath}`),
    "",
  ].join("\n")
}

function recoveryTransition(run: RunRow): PlanRecoveryTransition {
  return {
    before: {
      status: run.recovery_status,
      scope: run.recovery_scope,
      scopeRef: run.recovery_scope_ref,
      payloadJson: run.recovery_payload_json,
    },
    after: {
      status: run.recovery_status,
      scope: run.recovery_status ? "run" : run.recovery_scope,
      scopeRef: null,
      payloadJson: null,
    },
  }
}

function archivedPath(finalRoot: string, path: string, targetName: string): string {
  return join(finalRoot, path, targetName)
}

function supabaseRunHandoffDir(ctx: WorkflowContext): string {
  return join(layout.artefactsRoot(ctx.workspaceRoot!), "handoff", "supabase", ctx.runId)
}

export async function generateReplacementPlanFromArtifacts(
  input: GenerateReplacementPlanFromArtifactsInput,
): Promise<ImplementationPlanArtifact> {
  const run = input.repos.getRun(input.runId)
  if (!run) throw new Error(`run_not_found:${input.runId}`)
  const ctx = requireWorkflowContextForRun(input.repos, run)
  const currentPlan = await readPersistedPlan(join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"))
  const project = await loadProjectForPlan(ctx, currentPlan.project.id)
  const prd = await loadPrdForPlan(ctx, project.id)
  const architecture = await loadArchitectureForPlan(ctx)
  const previewRunId = `${run.id}__replan_preview__${randomUUID().slice(0, 8)}`
  const previewCtx = {
    ...ctx,
    runId: previewRunId,
    project,
    prd,
    architecture,
  } satisfies WithArchitecture
  try {
    return await planning(previewCtx, input.llm)
  } finally {
    await rm(layout.runDir({ ...ctx, runId: previewRunId }), { recursive: true, force: true })
  }
}

async function prepareReplanActivation(
  ctx: WorkflowContext,
  run: RunRow,
  currentPlan: PersistedImplementationPlanArtifact,
  replacementPlan: PersistedImplementationPlanArtifact,
  reason: string,
): Promise<PreparedReplanActivation> {
  const generatedAt = nowIso()
  const operationId = `replan-${Date.now()}-${randomUUID().slice(0, 8)}`
  const tempRoot = join(layout.runDir(ctx), ".tmp", operationId)
  const finalRoot = join(layout.runDir(ctx), "replans", operationId)
  const planningDir = layout.stageArtifactsDir(ctx, "planning")
  const executionWavesDir = join(layout.stageDir(ctx, "execution"), "waves")
  const handoffDir = layout.handoffDir(ctx)
  const supabaseDir = supabaseRunHandoffDir(ctx)

  const archivedArtifacts: PlanArchiveAction[] = [
    {
      kind: "planning-json",
      action: "copied",
      sourcePath: join(planningDir, "implementation-plan.json"),
      archivedPath: archivedPath(finalRoot, "planning", "implementation-plan.json"),
    },
    {
      kind: "planning-markdown",
      action: "copied",
      sourcePath: join(planningDir, "implementation-plan.md"),
      archivedPath: archivedPath(finalRoot, "planning", "implementation-plan.md"),
    },
  ]
  if (await pathExists(executionWavesDir)) {
    archivedArtifacts.push({
      kind: "execution-waves",
      action: "moved",
      sourcePath: executionWavesDir,
      archivedPath: archivedPath(finalRoot, "execution", "waves"),
    })
  }
  if (await pathExists(handoffDir)) {
    archivedArtifacts.push({
      kind: "handoffs",
      action: "moved",
      sourcePath: handoffDir,
      archivedPath: archivedPath(finalRoot, "handoffs", "active"),
    })
  }
  if (await pathExists(supabaseDir)) {
    archivedArtifacts.push({
      kind: "supabase-handoff",
      action: "moved",
      sourcePath: supabaseDir,
      archivedPath: archivedPath(finalRoot, "supabase", "handoff"),
    })
  }

  const transition = recoveryTransition(run)
  const record: PlanRegenerationRecord = {
    operationId,
    reason,
    generatedAt,
    before: currentPlan.metadata.activePlan,
    after: replacementPlan.metadata.activePlan,
    archivedArtifacts,
    recoveryTransition: transition,
  }
  const nextPlan: PersistedImplementationPlanArtifact = {
    ...replacementPlan,
    metadata: {
      activePlan: replacementPlan.metadata.activePlan,
      history: [...currentPlan.metadata.history, record],
    },
  }

  const stagedPlanJsonPath = join(tempRoot, "planning", "implementation-plan.json")
  const stagedPlanMarkdownPath = join(tempRoot, "planning", "implementation-plan.md")
  const stagedAuditJsonPath = join(tempRoot, "audit", "plan-regenerated.json")
  const stagedAuditMarkdownPath = join(tempRoot, "audit", "plan-regenerated.md")

  await writeJson(stagedPlanJsonPath, nextPlan)
  await writeFile(stagedPlanMarkdownPath, `${renderPlanMarkdown(nextPlan)}\n`)
  await writeJson(stagedAuditJsonPath, record)
  await writeFile(stagedAuditMarkdownPath, `${auditMarkdown(record)}\n`)

  return {
    operationId,
    before: record.before,
    after: record.after,
    tempRoot,
    finalRoot,
    stagedPlanJsonPath,
    stagedPlanMarkdownPath,
    stagedAuditJsonPath,
    stagedAuditMarkdownPath,
    archivedArtifacts,
    recoveryTransition: transition,
  }
}

async function copyIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (!await pathExists(sourcePath)) return
  await ensureDir(dirname(targetPath))
  await copyFile(sourcePath, targetPath)
}

async function moveIfExists(sourcePath: string, targetPath: string): Promise<boolean> {
  if (!await pathExists(sourcePath)) return false
  await ensureDir(dirname(targetPath))
  await rename(sourcePath, targetPath)
  return true
}

async function activatePreparedReplan(
  input: PerformExplicitReplanInput,
  ctx: WorkflowContext,
  run: RunRow,
  prepared: PreparedReplanActivation,
): Promise<void> {
  await ensureDir(prepared.finalRoot)

  const movedPaths: Array<{ source: string; archived: string }> = []
  try {
    for (const artifact of prepared.archivedArtifacts) {
      if (artifact.action === "copied") {
        await copyIfExists(artifact.sourcePath, artifact.archivedPath)
        continue
      }
      if (await moveIfExists(artifact.sourcePath, artifact.archivedPath)) {
        movedPaths.push({ source: artifact.sourcePath, archived: artifact.archivedPath })
      }
    }

    await ensureDir(dirname(join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json")))
    await copyFile(prepared.stagedPlanJsonPath, join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"))
    await copyFile(prepared.stagedPlanMarkdownPath, join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.md"))
    await copyFile(prepared.stagedAuditJsonPath, join(prepared.finalRoot, "plan-regenerated.json"))
    await copyFile(prepared.stagedAuditMarkdownPath, join(prepared.finalRoot, "plan-regenerated.md"))

    input.repos.updateRun(run.id, {
      recovery_status: prepared.recoveryTransition.after.status,
      recovery_scope: prepared.recoveryTransition.after.scope,
      recovery_scope_ref: prepared.recoveryTransition.after.scopeRef,
      recovery_summary: run.recovery_summary,
      recovery_payload_json: prepared.recoveryTransition.after.payloadJson,
    })

    input.repos.recordArtifact({
      runId: run.id,
      label: `Plan Regeneration Audit JSON (${prepared.operationId})`,
      kind: "json",
      path: join(prepared.finalRoot, "plan-regenerated.json"),
    })
    input.repos.recordArtifact({
      runId: run.id,
      label: `Plan Regeneration Audit Markdown (${prepared.operationId})`,
      kind: "md",
      path: join(prepared.finalRoot, "plan-regenerated.md"),
    })
    input.repos.recordArtifact({
      runId: run.id,
      label: planJsonArchiveLabel(prepared.before.version),
      kind: "json",
      path: join(prepared.finalRoot, "planning", "implementation-plan.json"),
    })
    input.repos.recordArtifact({
      runId: run.id,
      label: planMarkdownArchiveLabel(prepared.before.version),
      kind: "md",
      path: join(prepared.finalRoot, "planning", "implementation-plan.md"),
    })

    const event = {
      type: "plan_regenerated" as const,
      runId: run.id,
      reason: input.reason,
      operationId: prepared.operationId,
      before: prepared.before,
      after: prepared.after,
      archivedArtifacts: prepared.archivedArtifacts,
      recoveryTransition: prepared.recoveryTransition,
    }
    if (input.io) {
      input.io.emit(event)
    } else {
      input.repos.appendLog({
        runId: run.id,
        eventType: "plan_regenerated",
        message: input.reason,
        data: {
          operationId: prepared.operationId,
          reason: input.reason,
          before: prepared.before,
          after: prepared.after,
          archivedArtifacts: prepared.archivedArtifacts,
          recoveryTransition: prepared.recoveryTransition,
        },
      })
    }
  } catch (error) {
    const movedPathsInReverse = [...movedPaths].reverse()
    for (const moved of movedPathsInReverse) {
      if (await pathExists(moved.archived)) {
        await ensureDir(dirname(moved.source))
        await rename(moved.archived, moved.source)
      }
    }
    throw error
  }
}

export async function performExplicitReplan(input: PerformExplicitReplanInput): Promise<void> {
  const run = input.repos.getRun(input.runId)
  if (!run) throw new Error(`run_not_found:${input.runId}`)
  const ctx = requireWorkflowContextForRun(input.repos, run)
  const planJsonPath = join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json")
  const currentPlan = await readPersistedPlan(planJsonPath)
  const replacementBase = await input.generatePlan(currentPlan)
  const nextVersion = currentPlan.metadata.activePlan.version + 1
  const generatedAt = nowIso()
  const { artifact: replacementPlan } = namespaceReplacementPlan(replacementBase, nextVersion, generatedAt)
  const prepared = await prepareReplanActivation(ctx, run, currentPlan, replacementPlan, input.reason)
  try {
    await input.hooks?.afterPreparation?.()
    await activatePreparedReplan(input, ctx, run, prepared)
  } finally {
    await rm(prepared.tempRoot, { recursive: true, force: true })
  }
}

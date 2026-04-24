import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  branchNameItem,
  branchNameProject,
  createCandidateBranch,
  finalizeCandidateDecision,
  mergeProjectBranchIntoItem,
} from "./core/repoSimulation.js"
import {
  detectRealGitMode,
  exitRunToItemBranchReal,
  ensureItemBranchReal,
  ensureProjectBranchReal,
  mergeProjectIntoItemReal,
} from "./core/realGit.js"
import { resolveBaseBranchForItem } from "./core/baseBranch.js"
import { writeRecoveryRecord, type RecoveryScope } from "./core/recovery.js"
import { layout } from "./core/workspaceLayout.js"
import type {
  ArchitectureArtifact,
  Concept,
  DesignArtifact,
  DocumentationArtifact,
  Item,
  PRD,
  ProjectContext,
  Project,
  ProjectReviewArtifact,
  ImplementationPlanArtifact,
  ReferenceInput,
  WaveSummary,
  WireframeArtifact,
  WithDocumentation,
  WorkflowContext,
} from "./types.js"
import { mergeAmendments, projectDesign, projectWireframes } from "./core/designPrep.js"
import { stagePresent } from "./core/stagePresentation.js"
import { ask } from "./sim/human.js"
import { emitEvent, getActiveRun, withStageLifecycle } from "./core/runContext.js"
import { brainstorm } from "./stages/brainstorm/index.js"
import { visualCompanion } from "./stages/visual-companion/index.js"
import { frontendDesign } from "./stages/frontend-design/index.js"
import { requirements } from "./stages/requirements/index.js"
import { architecture } from "./stages/architecture/index.js"
import { planning } from "./stages/planning/index.js"
import { projectReview } from "./stages/project-review/index.js"
import { execution } from "./stages/execution/index.js"
import { qa } from "./stages/qa/index.js"
import { documentation } from "./stages/documentation/index.js"
import type { RunLlmConfig } from "./llm/registry.js"
import type { ExecutionLlmOptions } from "./stages/execution/index.js"

type ExecutionResumeOptions = {
  waveNumber?: number
  storyId?: string
  rerunTestWriter?: boolean
}

type ProjectResumePlan = {
  startStage:
    | "requirements"
    | "architecture"
    | "planning"
    | "execution"
    | "project-review"
    | "qa"
    | "documentation"
    | "handoff"
  execution?: ExecutionResumeOptions
}

type ItemResumePlan = {
  startStage: "brainstorm" | "visual-companion" | "frontend-design" | "projects"
}

type DesignPrepFreeze = {
  projectIds: string[]
}

const projectStageOrder = [
  "requirements",
  "architecture",
  "planning",
  "execution",
  "project-review",
  "qa",
  "documentation",
  "handoff",
] as const

/**
 * Enumerate files in the item workspace's `references/` directory so the
 * design-prep stages (visual-companion, frontend-design) can see images,
 * PDFs, and other reference material the operator dropped there. Returns
 * an empty array if the directory is missing — stages interpret that as
 * `inputMode: "none"` by default.
 */
function loadItemWorkspaceReferences(context: WorkflowContext): ReferenceInput[] {
  const workspaceDir = layout.workspaceDir(context.workspaceId)
  const refsDir = join(workspaceDir, "references")
  if (!existsSync(refsDir)) return []
  try {
    return readdirSync(refsDir)
      .filter(name => !name.startsWith("."))
      .map(name => ({
        value: join(refsDir, name),
        description: name,
      }))
  } catch {
    return []
  }
}

function shouldRunProjectStage(
  resume: ProjectResumePlan | undefined,
  stage: (typeof projectStageOrder)[number],
): boolean {
  if (!resume) return true
  return projectStageOrder.indexOf(stage) >= projectStageOrder.indexOf(resume.startStage)
}

export type WorkflowResumeInput = {
  scope: RecoveryScope
  currentStage?: string | null
}

export type WorkflowLlmOptions = {
  stage?: RunLlmConfig
  execution?: ExecutionLlmOptions
}

class BlockedRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedRunError"
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

async function blockRunForWorkspaceState(context: WorkflowContext, summary: string): Promise<never> {
  const activeRun = getActiveRun()
  if (activeRun) {
    await writeRecoveryRecord(context, {
      status: "blocked",
      cause: "system_error",
      scope: { type: "run", runId: activeRun.runId },
      summary,
      detail: "Clean, commit, or stash the current workspace changes before starting a new item run.",
      evidencePaths: [layout.runDir(context)],
    })
    emitEvent({
      type: "run_blocked",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      title: activeRun.title ?? activeRun.itemId,
      scope: { type: "run", runId: activeRun.runId },
      cause: "system_error",
      summary,
    })
  }
  throw new BlockedRunError(summary)
}

function currentGitBranch(workspaceRoot: string): string | null {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  const branch = result.status === 0 ? result.stdout.trim() : ""
  return branch || null
}

function normalizeExecutionResume(stageId: string): ExecutionResumeOptions | undefined {
  const match = /^execution\/waves\/(\d+)\/stories\/([^/]+)\/test-writer$/.exec(stageId)
  if (!match) return undefined
  return {
    waveNumber: Number(match[1]),
    storyId: match[2],
    rerunTestWriter: true,
  }
}

function normalizeProjectResume(input: WorkflowResumeInput): ProjectResumePlan | null {
  const scope = input.scope
  const stageId = scope.type === "stage" ? scope.stageId : scope.type === "run" ? input.currentStage ?? "" : "execution"
  const topStage = stageId.split("/")[0]

  switch (topStage) {
    case "brainstorm":
      return null
    case "requirements":
    case "architecture":
    case "planning":
    case "project-review":
    case "qa":
    case "documentation":
    case "handoff":
      return { startStage: topStage }
    case "execution":
      return {
        startStage: "execution",
        execution:
          scope.type === "story"
            ? { waveNumber: scope.waveNumber, storyId: scope.storyId }
            : normalizeExecutionResume(stageId),
      }
    default:
      return null
  }
}

function normalizeItemResume(input: WorkflowResumeInput): ItemResumePlan {
  const scope = input.scope
  const stageId = scope.type === "stage" ? scope.stageId : scope.type === "run" ? input.currentStage ?? "" : "projects"
  const topStage = stageId.split("/")[0]
  switch (topStage) {
    case "brainstorm":
      return { startStage: "brainstorm" }
    case "visual-companion":
      return { startStage: "visual-companion" }
    case "frontend-design":
      return { startStage: "frontend-design" }
    default:
      return { startStage: "projects" }
  }
}

async function loadProjects(context: WorkflowContext): Promise<Project[]> {
  return readJson<Project[]>(join(layout.stageArtifactsDir(context, "brainstorm"), "projects.json"))
}

async function loadConcept(context: WorkflowContext): Promise<Concept & { hasUi?: boolean }> {
  try {
    return await readJson<Concept & { hasUi?: boolean }>(join(layout.stageArtifactsDir(context, "brainstorm"), "concept.json"))
  } catch {
    const projects = await loadProjects(context)
    const fallback = projects[0]?.concept ?? {
      summary: "Recovered concept from brainstorm projects",
      problem: "Concept file missing during resume",
      users: ["unknown"],
      constraints: ["Recovered from project artifacts"],
    }
    return { ...fallback, hasUi: projects.some(project => project.hasUi === true) }
  }
}

async function loadWireframes(context: WorkflowContext): Promise<WireframeArtifact> {
  return readJson<WireframeArtifact>(join(layout.stageArtifactsDir(context, "visual-companion"), "wireframes.json"))
}

async function loadDesign(context: WorkflowContext): Promise<DesignArtifact> {
  return readJson<DesignArtifact>(join(layout.stageArtifactsDir(context, "frontend-design"), "design.json"))
}

async function loadDesignPrepFreeze(context: WorkflowContext): Promise<DesignPrepFreeze | null> {
  try {
    return await readJson<DesignPrepFreeze>(join(layout.stageArtifactsDir(context, "visual-companion"), "project-freeze.json"))
  } catch {
    return null
  }
}

function normalizedProjectIds(projects: Project[]): string[] {
  return [...projects.map(project => project.id)].sort()
}

function sameProjectSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

async function assertDesignPrepProjectFreeze(context: WorkflowContext, projects: Project[]): Promise<void> {
  const freeze = await loadDesignPrepFreeze(context)
  if (!freeze) return
  const currentIds = normalizedProjectIds(projects)
  const frozenIds = [...freeze.projectIds].sort()
  if (sameProjectSet(currentIds, frozenIds)) return
  const summary =
    `Resume blocked: brainstorm project set changed after design prep. ` +
    `Frozen=[${frozenIds.join(", ")}], current=[${currentIds.join(", ")}]. Re-run visual-companion and frontend-design.`
  await writeRecoveryRecord(context, {
    status: "blocked",
    cause: "system_error",
    scope: { type: "run", runId: context.runId },
    summary,
    detail: "Project bindings in wireframes/design artifacts no longer match brainstorm output.",
    evidencePaths: [layout.stageArtifactsDir(context, "visual-companion"), layout.stageArtifactsDir(context, "frontend-design")],
  })
  const activeRun = getActiveRun()
  if (activeRun) {
    emitEvent({
      type: "run_blocked",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      title: activeRun.title ?? activeRun.itemId,
      scope: { type: "run", runId: activeRun.runId },
      cause: "system_error",
      summary,
    })
  }
  throw new BlockedRunError(summary)
}

async function loadPrd(context: WorkflowContext): Promise<PRD> {
  const artifact = await readJson<{ prd: PRD }>(join(layout.stageArtifactsDir(context, "requirements"), "prd.json"))
  return artifact.prd
}

async function loadArchitecture(context: WorkflowContext): Promise<ArchitectureArtifact> {
  return readJson<ArchitectureArtifact>(join(layout.stageArtifactsDir(context, "architecture"), "architecture.json"))
}

async function loadPlan(context: WorkflowContext): Promise<ImplementationPlanArtifact> {
  return readJson<ImplementationPlanArtifact>(join(layout.stageArtifactsDir(context, "planning"), "implementation-plan.json"))
}

async function loadExecutionSummaries(context: WorkflowContext, plan: ImplementationPlanArtifact): Promise<WaveSummary[]> {
  return Promise.all(plan.plan.waves.map(wave => readJson<WaveSummary>(layout.waveSummaryFile(context, wave.number))))
}

async function loadProjectReview(context: WorkflowContext): Promise<ProjectReviewArtifact> {
  return readJson<ProjectReviewArtifact>(join(layout.stageArtifactsDir(context, "project-review"), "project-review.json"))
}

async function loadDocumentation(context: WorkflowContext): Promise<DocumentationArtifact> {
  return readJson<DocumentationArtifact>(join(layout.stageArtifactsDir(context, "documentation"), "documentation.json"))
}

export async function runWorkflow(item: Item, options?: { resume?: WorkflowResumeInput; llm?: WorkflowLlmOptions; workspaceRoot?: string }): Promise<void> {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const activeRun = getActiveRun()
  const { branch: baseBranch, source: baseBranchSource } = resolveBaseBranchForItem(item.baseBranch, options?.workspaceRoot)
  stagePresent.dim(`→ Base branch: ${baseBranch} (source: ${baseBranchSource})`)
  const context: WorkflowContext = {
    workspaceId: slug ? `${slug}-${item.id.toLowerCase()}` : item.id.toLowerCase(),
    runId: activeRun?.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    itemSlug: slug || item.id.toLowerCase(),
    baseBranch,
    workspaceRoot: options?.workspaceRoot,
  }

  const realGit = detectRealGitMode(context)
  if (realGit.enabled) {
    stagePresent.dim(`→ Real git mode: branches will be created in ${realGit.workspaceRoot}`)
  } else if (options?.workspaceRoot && realGit.reason === "workspace has uncommitted changes (dirty repo)") {
    const currentBranch = currentGitBranch(options.workspaceRoot)
    const summary =
      currentBranch === "main" || currentBranch === "master"
        ? `Workspace ${options.workspaceRoot} has uncommitted changes on ${currentBranch}. ` +
          "Strategy violation: main/master must stay clean; item work belongs on isolated item branches."
        : `Workspace ${options.workspaceRoot} has uncommitted changes. ` +
          "BeerEngineer requires a clean repo before it creates an isolated item branch."
    stagePresent.warn(summary)
    await blockRunForWorkspaceState(context, summary)
  } else {
    stagePresent.dim(`→ Simulated git mode (${realGit.reason})`)
  }

  try {
    if (realGit.enabled) ensureItemBranchReal(realGit, context)

    const itemResumePlan = options?.resume ? normalizeItemResume(options.resume) : { startStage: "brainstorm" as const }
    const resumePlan = options?.resume ? normalizeProjectResume(options.resume) : null
    const projects =
      itemResumePlan.startStage === "brainstorm"
        ? await withStageLifecycle("brainstorm", {}, () => brainstorm(item, context, options?.llm?.stage))
        : await loadProjects(context)
    if (itemResumePlan.startStage === "projects") {
      await assertDesignPrepProjectFreeze(context, projects)
    }
    const itemConcept = await loadConcept(context)
    const itemHasUi = projects.some(project => project.hasUi === true)
    // If we were asked to skip directly to projects but the seeded artifacts
    // aren't actually present (legacy run, partial seed), fall back to running
    // the corresponding design-prep stage instead of crashing on ENOENT.
    const wireframesFileExists = existsSync(join(layout.stageArtifactsDir(context, "visual-companion"), "wireframes.json"))
    const designFileExists = existsSync(join(layout.stageArtifactsDir(context, "frontend-design"), "design.json"))
    const shouldRunVisualCompanion = itemHasUi && (
      itemResumePlan.startStage === "brainstorm" ||
      itemResumePlan.startStage === "visual-companion" ||
      !wireframesFileExists
    )
    const shouldRunFrontendDesign = itemHasUi && (
      shouldRunVisualCompanion ||
      itemResumePlan.startStage === "frontend-design" ||
      !designFileExists
    )
    const designPrepReferences = loadItemWorkspaceReferences(context)
    const wireframes =
      !itemHasUi
        ? undefined
        : shouldRunVisualCompanion
        ? await withStageLifecycle("visual-companion", {}, () =>
            visualCompanion(context, { itemConcept, projects, references: designPrepReferences }, options?.llm?.stage),
          )
        : await loadWireframes(context)
    const design =
      !itemHasUi
        ? undefined
        : shouldRunFrontendDesign
        ? await withStageLifecycle("frontend-design", {}, () =>
            frontendDesign(context, { itemConcept, projects, wireframes, references: designPrepReferences }, options?.llm?.stage),
          )
        : await loadDesign(context)
    if (activeRun) {
      projects.forEach((project, index) => {
        emitEvent({
          type: "project_created",
          runId: activeRun.runId,
          itemId: activeRun.itemId,
          projectId: project.id,
          code: project.id,
          name: project.name,
          summary: project.description,
          position: index,
        })
      })
    }

    for (const project of projects) {
      if (realGit.enabled) ensureProjectBranchReal(realGit, context, project.id)
      const conceptAmendments = [
        ...(wireframes?.conceptAmendments ?? []),
        ...(design?.conceptAmendments ?? []),
      ]
      await runProject(
        {
          ...context,
          project: { ...project, concept: mergeAmendments(project.concept, conceptAmendments, project.id) },
          wireframes: wireframes ? projectWireframes(wireframes, project.id) : undefined,
          design: design ? projectDesign(design) : undefined,
        },
        resumePlan ?? undefined,
        options?.llm,
      )
      if (realGit.enabled) mergeProjectIntoItemReal(realGit, context, project.id)
    }

    stagePresent.header("DONE")
    stagePresent.ok(`Item "${item.title}" is done ✓`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (realGit.enabled && (message.startsWith("realGit:") || message.startsWith("branch_gate:"))) {
      const summary =
        `Run blocked: git branch gate failed for "${item.title}". ` +
        `${message.replace(/^branch_gate:\s*/, "").replace(/^realGit:\s*/, "")}`
      stagePresent.warn(summary)
      await blockRunForWorkspaceState(context, summary)
    }
    throw error
  } finally {
    if (realGit.enabled) {
      try {
        const exitBranch = exitRunToItemBranchReal(realGit, context)
        stagePresent.dim(`→ Run exit branch: ${exitBranch}`)
      } catch (error) {
        stagePresent.warn(`Run exit branch restore failed: ${(error as Error).message}`)
      }
    }
  }
}

async function runProject(initialCtx: ProjectContext, resume?: ProjectResumePlan, llm?: WorkflowLlmOptions): Promise<void> {
  let ctx = initialCtx
  const projectId = ctx.project.id

  if (shouldRunProjectStage(resume, "requirements")) {
    ctx = { ...ctx, prd: await withStageLifecycle("requirements", { projectId }, () => requirements(ctx, llm?.stage)) }
  } else {
    ctx = { ...ctx, prd: await loadPrd(ctx) }
  }

  if (shouldRunProjectStage(resume, "architecture")) {
    ctx = { ...ctx, architecture: await withStageLifecycle("architecture", { projectId }, () => architecture(assertWithPrd(ctx), llm?.stage)) }
  } else {
    ctx = { ...ctx, architecture: await loadArchitecture(ctx) }
  }

  if (shouldRunProjectStage(resume, "planning")) {
    ctx = { ...ctx, plan: await withStageLifecycle("planning", { projectId }, () => planning(assertWithArchitecture(ctx), llm?.stage)) }
  } else {
    ctx = { ...ctx, plan: await loadPlan(ctx) }
  }

  if (shouldRunProjectStage(resume, "execution")) {
    ctx = {
      ...ctx,
      executionSummaries: await withStageLifecycle("execution", { projectId }, () =>
        execution(assertWithPlan(ctx), resume?.execution, llm?.execution),
      ),
    }
  } else {
    ctx = { ...ctx, executionSummaries: await loadExecutionSummaries(ctx, assertWithPlan(ctx).plan) }
  }

  if (shouldRunProjectStage(resume, "project-review")) {
    ctx = { ...ctx, projectReview: await withStageLifecycle("project-review", { projectId }, () => projectReview(assertWithExecution(ctx), llm?.stage)) }
  } else {
    ctx = { ...ctx, projectReview: await loadProjectReview(ctx) }
  }

  if (shouldRunProjectStage(resume, "qa")) {
    await withStageLifecycle("qa", { projectId }, () => qa(ctx, llm?.stage))
  }

  if (shouldRunProjectStage(resume, "documentation")) {
    ctx = { ...ctx, documentation: await withStageLifecycle("documentation", { projectId }, () => documentation(assertWithProjectReview(ctx), llm?.stage)) }
  } else {
    ctx = { ...ctx, documentation: await loadDocumentation(ctx) }
  }

  await mergeProjectBranchIntoItem(ctx, ctx.project.id)
  await withStageLifecycle("handoff", { projectId }, () => handoffProject(assertWithDocumentation(ctx)))
}

async function handoffProject(ctx: WithDocumentation): Promise<void> {
  const realGit = detectRealGitMode(ctx)
  if (realGit.enabled) {
    stagePresent.header(`handoff — ${ctx.project.name}`)
    stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`)
    stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`)
    stagePresent.dim(`→ Base branch: ${realGit.baseBranch}`)
    stagePresent.ok(`Project ${ctx.project.id} is already merged into ${branchNameItem(ctx)}; handoff complete.`)
    return
  }

  const handoff = await createCandidateBranch(ctx, ctx.project, ctx.documentation)
  stagePresent.header(`handoff — ${ctx.project.name}`)
  stagePresent.ok(handoff.summary)
  stagePresent.dim(`→ Candidate: ${handoff.candidateBranch.name}`)
  stagePresent.dim(`→ Parent: ${handoff.candidateBranch.base}`)
  stagePresent.dim(`→ Base: ${handoff.mergeTargetBranch}`)
  handoff.mergeChecklist.forEach(item => stagePresent.dim(`→ ${item}`))

  const decisionRaw = await ask("  Test, merge or reject candidate? [test/merge/reject] > ")
  const decision = normalizeDecision(decisionRaw)
  const updated = await finalizeCandidateDecision(ctx, handoff, decision)
  stagePresent.ok(updated.summary)
}

function normalizeDecision(input: string): "test" | "merge" | "reject" {
  const normalized = input.trim().toLowerCase()
  if (normalized === "merge") return "merge"
  if (normalized === "reject") return "reject"
  return "test"
}

function assertWithPrd<T extends ProjectContext>(ctx: T): T & { prd: NonNullable<T["prd"]> } {
  if (!ctx.prd) throw new Error("Pipeline invariant violated: PRD missing")
  return ctx as T & { prd: NonNullable<T["prd"]> }
}

function assertWithArchitecture<T extends ProjectContext>(ctx: T): T & {
  prd: NonNullable<T["prd"]>
  architecture: NonNullable<T["architecture"]>
} {
  if (!ctx.prd || !ctx.architecture) throw new Error("Pipeline invariant violated: prd/architecture missing")
  return ctx as never
}

function assertWithPlan<T extends ProjectContext>(ctx: T): T & {
  prd: NonNullable<T["prd"]>
  architecture: NonNullable<T["architecture"]>
  plan: NonNullable<T["plan"]>
} {
  if (!ctx.prd || !ctx.architecture || !ctx.plan) throw new Error("Pipeline invariant violated: plan missing")
  return ctx as never
}

function assertWithExecution<T extends ProjectContext>(ctx: T): T & {
  prd: NonNullable<T["prd"]>
  architecture: NonNullable<T["architecture"]>
  plan: NonNullable<T["plan"]>
  executionSummaries: NonNullable<T["executionSummaries"]>
} {
  if (!ctx.prd || !ctx.architecture || !ctx.plan || !ctx.executionSummaries) {
    throw new Error("Pipeline invariant violated: execution missing")
  }
  return ctx as never
}

function assertWithProjectReview<T extends ProjectContext>(ctx: T): T & {
  prd: NonNullable<T["prd"]>
  architecture: NonNullable<T["architecture"]>
  plan: NonNullable<T["plan"]>
  executionSummaries: NonNullable<T["executionSummaries"]>
  projectReview: NonNullable<T["projectReview"]>
} {
  if (!ctx.prd || !ctx.architecture || !ctx.plan || !ctx.executionSummaries || !ctx.projectReview) {
    throw new Error("Pipeline invariant violated: projectReview missing")
  }
  return ctx as never
}

function assertWithDocumentation<T extends ProjectContext>(ctx: T): WithDocumentation {
  if (!ctx.prd || !ctx.architecture || !ctx.plan || !ctx.executionSummaries || !ctx.projectReview || !ctx.documentation) {
    throw new Error("Pipeline invariant violated: documentation missing")
  }
  return ctx as WithDocumentation
}

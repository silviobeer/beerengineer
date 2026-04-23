import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
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
import { writeRecoveryRecord, type RecoveryScope } from "./core/recovery.js"
import { layout } from "./core/workspaceLayout.js"
import type {
  ArchitectureArtifact,
  DocumentationArtifact,
  Item,
  PRD,
  ProjectContext,
  Project,
  ProjectReviewArtifact,
  ImplementationPlanArtifact,
  WaveSummary,
  WithDocumentation,
  WorkflowContext,
} from "./types.js"
import { stagePresent } from "./core/stagePresentation.js"
import { ask } from "./sim/human.js"
import { emitEvent, getActiveRun, withStageLifecycle } from "./core/runContext.js"
import { brainstorm } from "./stages/brainstorm/index.js"
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

function isEngineOwnedBranchName(branch: string): boolean {
  return /^(item|proj|wave|story|candidate)\//.test(branch)
}

function resolveGitDefaultBranch(workspaceRoot: string): string | null {
  const originHead = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  if (originHead.status === 0) {
    const branch = originHead.stdout.trim().replace(/^origin\//, "")
    if (branch) return branch
  }

  const remoteShow = spawnSync("git", ["remote", "show", "origin"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  if (remoteShow.status === 0) {
    const match = remoteShow.stdout.match(/^\s*HEAD branch:\s+(.+)$/m)
    const branch = match?.[1]?.trim()
    if (branch) return branch
  }

  const current = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  const branch = current.status === 0 ? current.stdout.trim() : ""
  if (branch && !isEngineOwnedBranchName(branch)) return branch
  return null
}

function resolveBaseBranch(item: Item, workspaceRoot?: string): { branch: string; source: "item" | "env" | "config" | "git" | "default" } {
  const itemOverride = item.baseBranch?.trim()
  if (itemOverride) return { branch: itemOverride, source: "item" }
  const envOverride = process.env.BEERENGINEER_BASE_BRANCH?.trim()
  if (envOverride) return { branch: envOverride, source: "env" }

  // Prefer the workspace-config-recorded default branch over whatever happens
  // to be checked out right now: if a previous run crashed mid-execution, the
  // repo may still be parked on a story/wave/proj branch, and we must not
  // treat that as the "base".
  if (workspaceRoot) {
    try {
      const configPath = resolve(workspaceRoot, ".beerengineer", "workspace.json")
      const raw = readFileSync(configPath, "utf8")
      const parsed = JSON.parse(raw) as {
        preflight?: { github?: { defaultBranch?: string | null } }
        reviewPolicy?: { sonarcloud?: { baseBranch?: string } }
        sonar?: { baseBranch?: string }
      }
      const fromConfig =
        parsed.preflight?.github?.defaultBranch?.trim() ||
        parsed.reviewPolicy?.sonarcloud?.baseBranch?.trim() ||
        parsed.sonar?.baseBranch?.trim()
      if (fromConfig && !isEngineOwnedBranchName(fromConfig)) return { branch: fromConfig, source: "config" }
    } catch {
      // no config, fall through to git probe
    }
  }

  const branch = workspaceRoot ? resolveGitDefaultBranch(workspaceRoot) : null
  if (branch) return { branch, source: "git" }
  return { branch: "main", source: "default" }
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

async function loadProjects(context: WorkflowContext): Promise<Project[]> {
  return readJson<Project[]>(join(layout.stageArtifactsDir(context, "brainstorm"), "projects.json"))
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
  const { branch: baseBranch, source: baseBranchSource } = resolveBaseBranch(item, options?.workspaceRoot)
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

    const resumePlan = options?.resume ? normalizeProjectResume(options.resume) : null
    const projects = resumePlan
      ? await loadProjects(context)
      : await withStageLifecycle("brainstorm", {}, () => brainstorm(item, context, options?.llm?.stage))
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
      await runProject({ ...context, project }, resumePlan ?? undefined, options?.llm)
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
  await withStageLifecycle("handoff", { projectId }, () => handoffCandidate(assertWithDocumentation(ctx)))
}

async function handoffCandidate(ctx: WithDocumentation): Promise<void> {
  const realGit = detectRealGitMode(ctx)
  if (realGit.enabled) {
    stagePresent.header(`handoff — ${ctx.project.name}`)
    stagePresent.ok("Project already merged into the item branch in real git mode.")
    stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`)
    stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`)
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

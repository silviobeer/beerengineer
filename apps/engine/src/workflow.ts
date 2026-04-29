import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createGitAdapter, type GitAdapter } from "./core/gitAdapter.js"
import { resolveBaseBranchForItem } from "./core/baseBranch.js"
import { writeRecoveryRecord, type RecoveryCause, type RecoveryScope } from "./core/recovery.js"
import { layout } from "./core/workspaceLayout.js"
import type {
  Concept,
  DesignArtifact,
  Item,
  ProjectContext,
  Project,
  ReferenceInput,
  WireframeArtifact,
  WorkflowContext,
} from "./types.js"
import { mergeAmendments, projectDesign, projectWireframes } from "./core/designPrep.js"
import { loadCodebaseSnapshot } from "./core/codebaseSnapshot.js"
import { loadFrontendSnapshot } from "./core/frontendSnapshot.js"
import { loadItemDecisions } from "./core/itemDecisions.js"
import { stagePresent } from "./core/stagePresentation.js"
import { emitEvent, getActiveRun, withStageLifecycle } from "./core/runContext.js"
import { assignPort, isWorktreePortPoolExhaustedError } from "./core/portAllocator.js"
import { brainstorm } from "./stages/brainstorm/index.js"
import { visualCompanion } from "./stages/visual-companion/index.js"
import { frontendDesign } from "./stages/frontend-design/index.js"
import { mergeGate } from "./stages/mergeGate/index.js"
import {
  PROJECT_STAGE_REGISTRY,
  shouldRunProjectStage,
  type ExecutionResumeOptions,
  type ProjectResumePlan,
  type StageLlmOptions,
} from "./core/projectStageRegistry.js"
import { branchNameItem } from "./core/branchNames.js"
import { itemSlug, workflowWorkspaceId } from "./core/itemIdentity.js"

type ItemResumePlan = {
  startStage: "brainstorm" | "visual-companion" | "frontend-design" | "projects" | "merge-gate"
  /**
   * Prepared imports may already contain all upstream product artifacts.
   * When true, the item-level UI preparation stages are skipped entirely,
   * even when the item/project has UI.
   */
  skipDesignPrep?: boolean
  /**
   * When set, the item-level loop runs *only* the named stage and skips the
   * other design-prep stage. Manual-progression actions
   * (start_visual_companion / start_frontend_design) populate this so the
   * engine never auto-chains visual → design or back-fills missing artifacts.
   * Recovery and rerun_design_prep leave this undefined and keep the existing
   * non-strict behavior (run a stage if its artifact is missing).
   */
  manualStage?: "visual-companion" | "frontend-design"
}

type DesignPrepFreeze = {
  projectIds: string[]
}

/**
 * Enumerate files in the item workspace's `references/` directory so the
 * design-prep stages (visual-companion, frontend-design) can see images,
 * PDFs, and other reference material the operator dropped there. Returns
 * an empty array if the directory is missing — stages interpret that as
 * `inputMode: "none"` by default.
 */
function loadItemWorkspaceReferences(context: WorkflowContext): ReferenceInput[] {
  const workspaceDir = layout.workspaceDir(context)
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

export type WorkflowResumeInput = {
  scope: RecoveryScope
  currentStage?: string | null
  /**
   * Optional prepared-import override. When present, each project can enter
   * the project pipeline at a different stage: projects with imported PRDs
   * skip requirements, while incomplete projects run requirements first.
   */
  projectStartStages?: Record<string, ProjectResumePlan["startStage"]>
  /**
   * Paths copied into run artifacts before workflow start and therefore safe
   * to ignore for the initial dirty-repo branch gate.
   */
  dirtyCheckIgnoredPaths?: string[]
  /**
   * Skip brainstorm/design-prep item stages and enter the project pipeline
   * directly. Prepared imports set this when their source already supplied
   * concept/projects and optionally PRDs.
   */
  skipDesignPrep?: boolean
  /**
   * Manual-mode signal from the item-action service. When set, the workflow
   * runs *only* the named design-prep stage and skips the sibling, regardless
   * of artifact presence. See {@link ItemResumePlan.manualStage}.
   */
  manualStage?: "visual-companion" | "frontend-design"
}

export type WorkflowLlmOptions = StageLlmOptions

class BlockedRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedRunError"
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

const stageArtifactPath = (context: WorkflowContext, stage: string, file: string) =>
  join(layout.stageArtifactsDir(context, stage), file)

const loadStageArtifact = <T>(context: WorkflowContext, stage: string, file: string) =>
  readJson<T>(stageArtifactPath(context, stage, file))

async function blockRunForWorkspaceState(
  context: WorkflowContext,
  summary: string,
  opts: {
    cause?: RecoveryCause
    scope?: RecoveryScope
    detail?: string
    evidencePaths?: string[]
    branch?: string
  } = {},
): Promise<never> {
  const activeRun = getActiveRun()
  if (activeRun) {
    const scope = opts.scope ?? { type: "run", runId: activeRun.runId }
    await writeRecoveryRecord(context, {
      status: "blocked",
      cause: opts.cause ?? "system_error",
      scope,
      summary,
      detail: opts.detail ?? "Clean, commit, or stash the current workspace changes before starting a new item run.",
      evidencePaths: opts.evidencePaths ?? [layout.runDir(context)],
    })
    emitEvent({
      type: "run_blocked",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      title: activeRun.title ?? activeRun.itemId,
      scope,
      cause: opts.cause ?? "system_error",
      summary,
      branch: opts.branch,
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
  let stageId = "execution"
  if (scope.type === "stage") stageId = scope.stageId
  else if (scope.type === "run") stageId = input.currentStage ?? ""
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
      return { startStage: topStage, projectStartStages: input.projectStartStages }
    case "execution": {
      let executionScope = normalizeExecutionResume(stageId)
      if (scope.type === "story") {
        executionScope = { waveNumber: scope.waveNumber, storyId: scope.storyId }
      }
      return {
        startStage: "execution",
        execution: executionScope,
        projectStartStages: input.projectStartStages,
      }
    }
    default:
      return input.projectStartStages
        ? { startStage: "requirements", projectStartStages: input.projectStartStages }
        : null
  }
}

function normalizeItemResume(input: WorkflowResumeInput): ItemResumePlan {
  const scope = input.scope
  let stageId = "projects"
  if (scope.type === "stage") stageId = scope.stageId
  else if (scope.type === "run") stageId = input.currentStage ?? ""
  const topStage = stageId.split("/")[0]
  const startStage = (
    ["brainstorm", "visual-companion", "frontend-design", "merge-gate"] as const
  ).find(stage => stage === topStage) ?? "projects"
  return { startStage, manualStage: input.manualStage, skipDesignPrep: input.skipDesignPrep === true }
}

async function loadProjects(context: WorkflowContext): Promise<Project[]> {
  return loadStageArtifact<Project[]>(context, "brainstorm", "projects.json")
}

async function loadConcept(context: WorkflowContext): Promise<Concept & { hasUi?: boolean }> {
  try {
    return await loadStageArtifact<Concept & { hasUi?: boolean }>(context, "brainstorm", "concept.json")
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

const loadWireframes = (context: WorkflowContext) =>
  loadStageArtifact<WireframeArtifact>(context, "visual-companion", "wireframes.json")

const loadDesign = (context: WorkflowContext) =>
  loadStageArtifact<DesignArtifact>(context, "frontend-design", "design.json")

async function loadDesignPrepFreeze(context: WorkflowContext): Promise<DesignPrepFreeze | null> {
  try {
    return await loadStageArtifact<DesignPrepFreeze>(context, "visual-companion", "project-freeze.json")
  } catch {
    return null
  }
}

function normalizedProjectIds(projects: Project[]): string[] {
  return [...projects.map(project => project.id)].sort((left, right) => left.localeCompare(right))
}

function sameProjectSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

async function assertDesignPrepProjectFreeze(context: WorkflowContext, projects: Project[]): Promise<void> {
  const freeze = await loadDesignPrepFreeze(context)
  if (!freeze) return
  const currentIds = normalizedProjectIds(projects)
  const frozenIds = [...freeze.projectIds].sort((left, right) => left.localeCompare(right))
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

export async function runWorkflow(item: Item, options?: { resume?: WorkflowResumeInput; llm?: WorkflowLlmOptions; workspaceRoot?: string }): Promise<void> {
  const slug = itemSlug(item)
  const activeRun = getActiveRun()
  const { branch: baseBranch, source: baseBranchSource } = resolveBaseBranchForItem(item.baseBranch, options?.workspaceRoot)
  stagePresent.dim(`→ Base branch: ${baseBranch} (source: ${baseBranchSource})`)
  const context: WorkflowContext = {
    workspaceId: workflowWorkspaceId(item),
    runId: activeRun?.runId ?? `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    itemSlug: slug,
    baseBranch,
    workspaceRoot: options?.workspaceRoot,
    dirtyCheckIgnoredPaths: options?.resume?.dirtyCheckIgnoredPaths,
  }

  const git = await ensureWorkflowGitAdapter(context, options?.workspaceRoot)
  // Above blockRunForWorkspaceState always throws, so `git` is defined here.
  stagePresent.dim(`→ Real git mode: branches will be created in ${git.mode.workspaceRoot}`)

  try {
    git.ensureItemBranch()
    git.assertWorkspaceRootOnBaseBranch("after ensureItemBranch (run start)")
    const itemWorktreeLlm = workflowLlmForWorkspace(options?.llm, git.mode.itemWorktreeRoot)
    const itemResumePlan = options?.resume
      ? normalizeItemResume(options.resume)
      : { startStage: "brainstorm" as const }
    const resumePlan = options?.resume ? normalizeProjectResume(options.resume) : null
    // Load the workspace snapshot once per item. Brownfield context (existing
    // README, AGENTS.md, prior docs/, top-level config files, tree summary)
    // is the same for every stage of this item; reading it N times — once per
    // project — was the previous behavior. Loaded here so brainstorm /
    // visual-companion / frontend-design also receive it.
    const codebaseSnapshot = loadCodebaseSnapshot(options?.workspaceRoot)
    const projects = await resolveWorkflowProjects(item, context, git, itemResumePlan, itemWorktreeLlm?.stage, codebaseSnapshot)
    if (itemResumePlan.startStage === "projects") {
      await assertDesignPrepProjectFreeze(context, projects)
    }
    emitWorkflowPreviewPort(context, activeRun)
    const itemConcept = await loadConcept(context)
    const itemHasUi = projects.some(project => project.hasUi === true)
    const itemSnapshot = buildItemSnapshot(codebaseSnapshot, itemHasUi, options?.workspaceRoot)
    const { wireframes, design } = await resolveDesignPrepArtifacts(
      context,
      itemResumePlan,
      itemHasUi,
      itemConcept,
      projects,
      itemWorktreeLlm?.stage,
      itemSnapshot,
    )
    emitWorkflowProjectsCreated(activeRun, projects)

    if (itemResumePlan.startStage !== "merge-gate") {
      await runWorkflowProjects({
        context,
        projects,
        git,
        wireframes,
        design,
        itemSnapshot,
        resumePlan,
        llm: itemWorktreeLlm,
      })
    }

    await withStageLifecycle("merge-gate", () => mergeGate(context, git, blockRunForWorkspaceState), {})

    stagePresent.header("DONE")
    stagePresent.ok(`Item "${item.title}" is done ✓`)
  } catch (error) {
    await handleWorkflowFailure(context, item.title, error)
    throw error
  } finally {
    restoreWorkflowExitState(git)
  }
}

export function workflowLlmForWorkspace(
  llm: WorkflowLlmOptions | undefined,
  workspaceRoot: string,
): WorkflowLlmOptions | undefined {
  if (!llm) return undefined
  const rebase = <T extends { workspaceRoot: string } | undefined>(config: T): T => {
    return config ? { ...config, workspaceRoot } : config
  }
  return {
    stage: rebase(llm.stage),
    execution: llm.execution
      ? {
          stage: rebase(llm.execution.stage),
          executionCoder: rebase(llm.execution.executionCoder),
        }
      : undefined,
  }
}

async function resolveWorkflowProjects(
  item: Item,
  context: WorkflowContext,
  git: ReturnType<typeof createGitAdapter>,
  itemResumePlan: ReturnType<typeof normalizeItemResume>,
  stageLlm: WorkflowLlmOptions["stage"] | undefined,
  codebaseSnapshot: ReturnType<typeof loadCodebaseSnapshot>,
): Promise<Project[]> {
  if (itemResumePlan.startStage === "brainstorm") {
    return withStageLifecycle("brainstorm", () => brainstorm(item, context, git, stageLlm, codebaseSnapshot), {})
  }
  git.ensureItemBranch()
  git.assertWorkspaceRootOnBaseBranch("after ensureItemBranch (resume past brainstorm)")
  return loadProjects(context)
}

function emitWorkflowPreviewPort(
  context: WorkflowContext,
  activeRun: ReturnType<typeof getActiveRun>,
): void {
  if (!context.workspaceRoot) return
  const port = assignPort(layout.itemWorktreeDir(context), branchNameItem(context), context.workspaceRoot)
  emitEvent({
    type: "worktree_port_assigned",
    runId: activeRun?.runId,
    branch: branchNameItem(context),
    worktreePath: layout.itemWorktreeDir(context),
    port,
  })
}

async function resolveDesignPrepArtifacts(
  context: WorkflowContext,
  itemResumePlan: ReturnType<typeof normalizeItemResume>,
  itemHasUi: boolean,
  itemConcept: Concept & { hasUi?: boolean },
  projects: Project[],
  stageLlm: WorkflowLlmOptions["stage"] | undefined,
  itemSnapshot: ReturnType<typeof buildItemSnapshot>,
): Promise<{ wireframes: WireframeArtifact | undefined; design: DesignArtifact | undefined }> {
  if (!itemHasUi) return { wireframes: undefined, design: undefined }
  if (itemResumePlan.skipDesignPrep) return { wireframes: undefined, design: undefined }
  const { shouldRunVisualCompanion, shouldRunFrontendDesign } = buildDesignPrepPlan(context, itemResumePlan)
  const references = loadItemWorkspaceReferences(context)
  const wireframes = shouldRunVisualCompanion
    ? await withStageLifecycle(
        "visual-companion",
        () => visualCompanion(context, { itemConcept, projects, references }, stageLlm, itemSnapshot),
        {},
      )
    : await loadWireframes(context)
  const design = shouldRunFrontendDesign
    ? await withStageLifecycle(
        "frontend-design",
        () => frontendDesign(context, { itemConcept, projects, wireframes, references }, stageLlm, itemSnapshot),
        {},
      )
    : await loadDesign(context)
  return { wireframes, design }
}

function emitWorkflowProjectsCreated(
  activeRun: ReturnType<typeof getActiveRun>,
  projects: Project[],
): void {
  if (!activeRun) return
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

async function runWorkflowProjects(
  options: {
    context: WorkflowContext
    projects: Project[]
    git: ReturnType<typeof createGitAdapter>
    wireframes: WireframeArtifact | undefined
    design: DesignArtifact | undefined
    itemSnapshot: ReturnType<typeof buildItemSnapshot>
    resumePlan: ReturnType<typeof normalizeProjectResume> | null
    llm: WorkflowLlmOptions | undefined
  },
): Promise<void> {
  const { context, projects, git, wireframes, design, itemSnapshot, resumePlan, llm } = options
  const conceptAmendments = [
    ...(wireframes?.conceptAmendments ?? []),
    ...(design?.conceptAmendments ?? []),
  ]
  const projectDesignArtifact = design ? projectDesign(design) : undefined
  const decisions = loadItemDecisions(context)
  for (const project of projects) {
    git.ensureProjectBranch(project.id)
    const projectResumePlan = resumePlan?.projectStartStages?.[project.id]
      ? { ...resumePlan, startStage: resumePlan.projectStartStages[project.id] }
      : resumePlan
    await runProject(
      {
        ...context,
        project: { ...project, concept: mergeAmendments(project.concept, conceptAmendments, project.id) },
        wireframes: wireframes ? projectWireframes(wireframes, project.id) : undefined,
        design: projectDesignArtifact,
        codebase: itemSnapshot,
        decisions,
      },
      git,
      projectResumePlan ?? undefined,
      llm,
    )
  }
}

async function handleWorkflowFailure(context: WorkflowContext, itemTitle: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  if (isWorktreePortPoolExhaustedError(error)) {
    const summary =
      `Run blocked: no preview port is available for "${itemTitle}". ` +
      "Expand BEERENGINEER_WORKTREE_PORT_POOL or the workspace worktreePortPool setting."
    stagePresent.warn(summary)
    await blockRunForWorkspaceState(context, summary, {
      cause: "worktree_port_pool_exhausted",
      detail: `Port allocation failed for item branch ${branchNameItem(context)}.`,
      branch: branchNameItem(context),
    })
  }
  if (message.startsWith("git:") || message.startsWith("branch_gate:")) {
    const summary =
      `Run blocked: git branch gate failed for "${itemTitle}". ` +
      `${message.replace(/^branch_gate:\s*/, "").replace(/^git:\s*/, "")}`
    stagePresent.warn(summary)
    await blockRunForWorkspaceState(context, summary)
  }
}

function restoreWorkflowExitState(git: ReturnType<typeof createGitAdapter>): void {
  try {
    const exitBranch = git.exitRunToItemBranch()
    stagePresent.dim(`→ Run exit branch: ${exitBranch}`)
  } catch (error) {
    stagePresent.warn(`Run exit branch restore failed: ${(error as Error).message}`)
  }
  try {
    git.assertWorkspaceRootOnBaseBranch("run exit")
  } catch (error) {
    stagePresent.warn(`Workspace root invariant failed at run exit: ${(error as Error).message}`)
  }
}

async function ensureWorkflowGitAdapter(context: WorkflowContext, workspaceRoot?: string) {
  try {
    return createGitAdapter(context)
  } catch (error) {
    const reason = (error as Error).message.replace(/^git:\s*/, "")
    const summary = workflowGitFailureSummary(reason, workspaceRoot)
    stagePresent.warn(summary)
    await blockRunForWorkspaceState(context, summary)
    throw error
  }
}

function workflowGitFailureSummary(reason: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return `Cannot start run: ${reason}`
  const currentBranch = currentGitBranch(workspaceRoot)
  if (!reason.includes("uncommitted changes")) return `Cannot start run: ${reason}`
  return currentBranch === "main" || currentBranch === "master"
    ? `Workspace ${workspaceRoot} has uncommitted changes on ${currentBranch}. Strategy violation: main/master must stay clean; item work belongs on isolated item branches.`
    : `Workspace ${workspaceRoot} has uncommitted changes. beerengineer_ requires a clean repo before it creates an isolated item branch.`
}

const buildItemSnapshot = (
  codebaseSnapshot: ReturnType<typeof loadCodebaseSnapshot>,
  includeUi: boolean,
  workspaceRoot?: string,
) => {
  if (!codebaseSnapshot || !includeUi) return codebaseSnapshot
  return { ...codebaseSnapshot, frontend: loadFrontendSnapshot(workspaceRoot) }
}

function buildDesignPrepPlan(
  context: WorkflowContext,
  itemResumePlan: ReturnType<typeof normalizeItemResume>,
) {
  const wireframesFileExists = existsSync(stageArtifactPath(context, "visual-companion", "wireframes.json"))
  const designFileExists = existsSync(stageArtifactPath(context, "frontend-design", "design.json"))
  const isManualVisual = itemResumePlan.manualStage === "visual-companion"
  const isManualFrontend = itemResumePlan.manualStage === "frontend-design"
  const shouldRunVisualCompanion = isManualVisual || (
    !itemResumePlan.manualStage && (
      itemResumePlan.startStage === "brainstorm" ||
      itemResumePlan.startStage === "visual-companion" ||
      !wireframesFileExists
    )
  )
  const shouldRunFrontendDesign = isManualFrontend || (
    !itemResumePlan.manualStage && (
      shouldRunVisualCompanion ||
      itemResumePlan.startStage === "frontend-design" ||
      !designFileExists
    )
  )
  return { shouldRunVisualCompanion, shouldRunFrontendDesign }
}

/**
 * Drives the project pipeline by iterating {@link PROJECT_STAGE_REGISTRY}.
 *
 * For each registered node we either execute it (with lifecycle wrapping)
 * or short-circuit to its `resumeFromDisk` loader when the resume plan
 * tells us to skip ahead. The trailing `handoff` step is the last entry
 * in the registry; nothing about runProject is special-cased per stage.
 */
async function runProject(
  initialCtx: ProjectContext,
  git: GitAdapter,
  resume?: ProjectResumePlan,
  llm?: WorkflowLlmOptions,
): Promise<void> {
  let ctx = initialCtx
  const projectId = ctx.project.id
  const deps = { llm, resume, git }

  for (const node of PROJECT_STAGE_REGISTRY) {
    ctx = shouldRunProjectStage(resume, node.id)
      ? await withStageLifecycle(node.id, () => node.run(ctx, deps), { projectId })
      : await node.resumeFromDisk(ctx)
  }
}

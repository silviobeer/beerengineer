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
import { createGitAdapter, type GitAdapter } from "./core/gitAdapter.js"
import { resolveBaseBranchForItem } from "./core/baseBranch.js"
import { writeRecoveryRecord, type RecoveryScope } from "./core/recovery.js"
import { layout } from "./core/workspaceLayout.js"
import type {
  Concept,
  DesignArtifact,
  Item,
  ProjectContext,
  Project,
  ReferenceInput,
  WireframeArtifact,
  WithDocumentation,
  WorkflowContext,
} from "./types.js"
import { mergeAmendments, projectDesign, projectWireframes } from "./core/designPrep.js"
import { loadCodebaseSnapshot } from "./core/codebaseSnapshot.js"
import { loadItemDecisions } from "./core/itemDecisions.js"
import { stagePresent } from "./core/stagePresentation.js"
import { ask } from "./sim/human.js"
import { emitEvent, getActiveRun, withStageLifecycle } from "./core/runContext.js"
import { brainstorm } from "./stages/brainstorm/index.js"
import { visualCompanion } from "./stages/visual-companion/index.js"
import { frontendDesign } from "./stages/frontend-design/index.js"
import {
  PROJECT_STAGE_REGISTRY,
  assertWithDocumentation,
  shouldRunProjectStage,
  type ExecutionResumeOptions,
  type ProjectResumePlan,
  type StageLlmOptions,
} from "./core/projectStageRegistry.js"

type ItemResumePlan = {
  startStage: "brainstorm" | "visual-companion" | "frontend-design" | "projects"
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

export type WorkflowResumeInput = {
  scope: RecoveryScope
  currentStage?: string | null
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

  const git = createGitAdapter(context)
  if (git.mode.enabled) {
    stagePresent.dim(`→ Real git mode: branches will be created in ${git.mode.workspaceRoot}`)
  } else if (options?.workspaceRoot && git.mode.reason === "workspace has uncommitted changes (dirty repo)") {
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
    stagePresent.dim(`→ Simulated git mode (${git.mode.reason})`)
  }

  try {
    git.ensureItemBranch()
    git.assertWorkspaceRootOnBaseBranch("after ensureItemBranchReal (run start)")

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
      git.ensureProjectBranch(project.id)
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
          codebase: loadCodebaseSnapshot(options?.workspaceRoot),
          decisions: loadItemDecisions(context.workspaceId),
        },
        git,
        resumePlan ?? undefined,
        options?.llm,
      )
      git.mergeProjectIntoItem(project.id)
      git.assertWorkspaceRootOnBaseBranch(`after merging project ${project.id} into item`)
    }

    stagePresent.header("DONE")
    stagePresent.ok(`Item "${item.title}" is done ✓`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (git.enabled && (message.startsWith("realGit:") || message.startsWith("branch_gate:"))) {
      const summary =
        `Run blocked: git branch gate failed for "${item.title}". ` +
        `${message.replace(/^branch_gate:\s*/, "").replace(/^realGit:\s*/, "")}`
      stagePresent.warn(summary)
      await blockRunForWorkspaceState(context, summary)
    }
    throw error
  } finally {
    if (git.enabled) {
      try {
        const exitBranch = git.exitRunToItemBranch()
        if (exitBranch) stagePresent.dim(`→ Run exit branch: ${exitBranch}`)
      } catch (error) {
        stagePresent.warn(`Run exit branch restore failed: ${(error as Error).message}`)
      }
      try {
        git.assertWorkspaceRootOnBaseBranch("run exit")
      } catch (error) {
        stagePresent.warn(`Workspace root invariant failed at run exit: ${(error as Error).message}`)
      }
    }
  }
}

/**
 * Drives the project pipeline by iterating {@link PROJECT_STAGE_REGISTRY}.
 *
 * For each registered node we either execute it (with lifecycle wrapping)
 * or short-circuit to its `resumeFromDisk` loader when the resume plan
 * tells us to skip ahead. The final `handoff` step lives outside the
 * registry because it owns a side effect — merging the project branch
 * into the item branch — that is not a pure stage artifact.
 */
async function runProject(
  initialCtx: ProjectContext,
  git: GitAdapter,
  resume?: ProjectResumePlan,
  llm?: WorkflowLlmOptions,
): Promise<void> {
  let ctx = initialCtx
  const projectId = ctx.project.id
  const deps = { llm, resume }

  for (const node of PROJECT_STAGE_REGISTRY) {
    ctx = shouldRunProjectStage(resume, node.id)
      ? await withStageLifecycle(node.id, { projectId }, () => node.run(ctx, deps))
      : await node.resumeFromDisk(ctx)
  }

  await mergeProjectBranchIntoItem(ctx, ctx.project.id)
  await withStageLifecycle("handoff", { projectId }, () => handoffProject(assertWithDocumentation(ctx), git))
}

async function handoffProject(ctx: WithDocumentation, git: GitAdapter): Promise<void> {
  if (git.mode.enabled) {
    stagePresent.header(`handoff — ${ctx.project.name}`)
    stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`)
    stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`)
    stagePresent.dim(`→ Base branch: ${git.mode.baseBranch}`)
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


/**
 * Declarative registry describing the per-project pipeline.
 *
 * Each stage is a {@link ProjectStageNode} with three responsibilities:
 *   1. `run`   — invoke the stage and return an updated context.
 *   2. `resumeFromDisk` — when skipped (resume path), reconstitute the
 *      same context update by loading the persisted artifact.
 *   3. `id`    — its position in {@link PROJECT_STAGE_ORDER}.
 *
 * The orchestrator iterates this array; adding/removing/reordering a
 * stage is a registry edit, not a control-flow rewrite of `runProject`.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { layout } from "./workspaceLayout.js"
import { architecture } from "../stages/architecture/index.js"
import { documentation } from "../stages/documentation/index.js"
import { execution, type ExecutionLlmOptions } from "../stages/execution/index.js"
import { planning } from "../stages/planning/index.js"
import { projectReview } from "../stages/project-review/index.js"
import { qa } from "../stages/qa/index.js"
import { requirements } from "../stages/requirements/index.js"
import type { RunLlmConfig } from "../llm/registry.js"
import type {
  ArchitectureArtifact,
  DocumentationArtifact,
  ImplementationPlanArtifact,
  PRD,
  ProjectContext,
  ProjectReviewArtifact,
  WaveSummary,
  WithArchitecture,
  WithDocumentation,
  WithExecution,
  WithPlan,
  WithPrd,
  WithProjectReview,
} from "../types.js"

export const PROJECT_STAGE_ORDER = [
  "requirements",
  "architecture",
  "planning",
  "execution",
  "project-review",
  "qa",
  "documentation",
  "handoff",
] as const

export type ProjectStageId = (typeof PROJECT_STAGE_ORDER)[number]

/**
 * Mirrors the (currently non-exported) shape used by the execution stage's
 * resume parameter. Defined here so the registry/orchestrator does not have
 * to depend on the execution stage's internal types — TS structural typing
 * keeps them compatible at the call site.
 */
export type ExecutionResumeOptions = {
  waveNumber?: number
  storyId?: string
  rerunTestWriter?: boolean
}

export type ProjectResumePlan = {
  startStage: ProjectStageId
  execution?: ExecutionResumeOptions
}

export type StageLlmOptions = {
  stage?: RunLlmConfig
  execution?: ExecutionLlmOptions
}

export type StageDeps = {
  llm?: StageLlmOptions
  resume?: ProjectResumePlan
}

/**
 * Generic node contract — uniform across every stage. The registry can
 * grow without the orchestrator learning new shapes.
 */
export interface ProjectStageNode {
  readonly id: ProjectStageId
  /** Execute the stage and fold its result into the context. */
  run(ctx: ProjectContext, deps: StageDeps): Promise<ProjectContext>
  /** Re-hydrate the same context update from persisted artifacts (resume path). */
  resumeFromDisk(ctx: ProjectContext): Promise<ProjectContext>
}

export function shouldRunProjectStage(
  resume: ProjectResumePlan | undefined,
  stage: ProjectStageId,
): boolean {
  if (!resume) return true
  return PROJECT_STAGE_ORDER.indexOf(stage) >= PROJECT_STAGE_ORDER.indexOf(resume.startStage)
}

// ---------- invariants ----------

export function assertWithPrd<T extends ProjectContext>(ctx: T): T & WithPrd {
  if (!ctx.prd) throw new Error("Pipeline invariant violated: PRD missing")
  return ctx as T & WithPrd
}

export function assertWithArchitecture<T extends ProjectContext>(ctx: T): T & WithArchitecture {
  if (!ctx.prd || !ctx.architecture) {
    throw new Error("Pipeline invariant violated: prd/architecture missing")
  }
  return ctx as T & WithArchitecture
}

export function assertWithPlan<T extends ProjectContext>(ctx: T): T & WithPlan {
  if (!ctx.prd || !ctx.architecture || !ctx.plan) {
    throw new Error("Pipeline invariant violated: plan missing")
  }
  return ctx as T & WithPlan
}

export function assertWithExecution<T extends ProjectContext>(ctx: T): T & WithExecution {
  if (!ctx.prd || !ctx.architecture || !ctx.plan || !ctx.executionSummaries) {
    throw new Error("Pipeline invariant violated: execution missing")
  }
  return ctx as T & WithExecution
}

export function assertWithProjectReview<T extends ProjectContext>(ctx: T): T & WithProjectReview {
  if (
    !ctx.prd ||
    !ctx.architecture ||
    !ctx.plan ||
    !ctx.executionSummaries ||
    !ctx.projectReview
  ) {
    throw new Error("Pipeline invariant violated: projectReview missing")
  }
  return ctx as T & WithProjectReview
}

export function assertWithDocumentation<T extends ProjectContext>(ctx: T): WithDocumentation {
  if (
    !ctx.prd ||
    !ctx.architecture ||
    !ctx.plan ||
    !ctx.executionSummaries ||
    !ctx.projectReview ||
    !ctx.documentation
  ) {
    throw new Error("Pipeline invariant violated: documentation missing")
  }
  return ctx as WithDocumentation
}

// ---------- disk loaders ----------

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

async function loadPrd(ctx: ProjectContext): Promise<PRD> {
  const artifact = await readJson<{ prd: PRD }>(
    join(layout.stageArtifactsDir(ctx, "requirements"), "prd.json"),
  )
  return artifact.prd
}

async function loadArchitecture(ctx: ProjectContext): Promise<ArchitectureArtifact> {
  return readJson<ArchitectureArtifact>(
    join(layout.stageArtifactsDir(ctx, "architecture"), "architecture.json"),
  )
}

async function loadPlan(ctx: ProjectContext): Promise<ImplementationPlanArtifact> {
  return readJson<ImplementationPlanArtifact>(
    join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"),
  )
}

async function loadExecutionSummaries(
  ctx: ProjectContext,
  plan: ImplementationPlanArtifact,
): Promise<WaveSummary[]> {
  return Promise.all(
    plan.plan.waves.map(wave => readJson<WaveSummary>(layout.waveSummaryFile(ctx, wave.number))),
  )
}

async function loadProjectReview(ctx: ProjectContext): Promise<ProjectReviewArtifact> {
  return readJson<ProjectReviewArtifact>(
    join(layout.stageArtifactsDir(ctx, "project-review"), "project-review.json"),
  )
}

async function loadDocumentation(ctx: ProjectContext): Promise<DocumentationArtifact> {
  return readJson<DocumentationArtifact>(
    join(layout.stageArtifactsDir(ctx, "documentation"), "documentation.json"),
  )
}

// ---------- nodes ----------

const requirementsNode: ProjectStageNode = {
  id: "requirements",
  run: async (ctx, deps) => ({ ...ctx, prd: await requirements(ctx, deps.llm?.stage) }),
  resumeFromDisk: async ctx => ({ ...ctx, prd: await loadPrd(ctx) }),
}

const architectureNode: ProjectStageNode = {
  id: "architecture",
  run: async (ctx, deps) => ({
    ...ctx,
    architecture: await architecture(assertWithPrd(ctx), deps.llm?.stage),
  }),
  resumeFromDisk: async ctx => ({ ...ctx, architecture: await loadArchitecture(ctx) }),
}

const planningNode: ProjectStageNode = {
  id: "planning",
  run: async (ctx, deps) => ({
    ...ctx,
    plan: await planning(assertWithArchitecture(ctx), deps.llm?.stage),
  }),
  resumeFromDisk: async ctx => ({ ...ctx, plan: await loadPlan(ctx) }),
}

const executionNode: ProjectStageNode = {
  id: "execution",
  run: async (ctx, deps) => ({
    ...ctx,
    executionSummaries: await execution(
      assertWithPlan(ctx),
      deps.resume?.execution,
      deps.llm?.execution,
    ),
  }),
  resumeFromDisk: async ctx => ({
    ...ctx,
    executionSummaries: await loadExecutionSummaries(ctx, assertWithPlan(ctx).plan),
  }),
}

const projectReviewNode: ProjectStageNode = {
  id: "project-review",
  run: async (ctx, deps) => ({
    ...ctx,
    projectReview: await projectReview(assertWithExecution(ctx), deps.llm?.stage),
  }),
  resumeFromDisk: async ctx => ({ ...ctx, projectReview: await loadProjectReview(ctx) }),
}

const qaNode: ProjectStageNode = {
  id: "qa",
  run: async (ctx, deps) => {
    await qa(ctx, deps.llm?.stage)
    return ctx
  },
  // QA produces no context artifact; skipping = no-op.
  resumeFromDisk: async ctx => ctx,
}

const documentationNode: ProjectStageNode = {
  id: "documentation",
  run: async (ctx, deps) => ({
    ...ctx,
    documentation: await documentation(assertWithProjectReview(ctx), deps.llm?.stage),
  }),
  resumeFromDisk: async ctx => ({ ...ctx, documentation: await loadDocumentation(ctx) }),
}

/**
 * Stages requirements → documentation, in execution order. The trailing
 * `handoff` step is intentionally not in the registry: it owns the
 * cross-stage project-merge side effect and is invoked separately after
 * the loop terminates. Adding it here would conflate "produce artifacts"
 * with "merge branches" — two responsibilities best kept distinct.
 */
export const PROJECT_STAGE_REGISTRY: readonly ProjectStageNode[] = [
  requirementsNode,
  architectureNode,
  planningNode,
  executionNode,
  projectReviewNode,
  qaNode,
  documentationNode,
]

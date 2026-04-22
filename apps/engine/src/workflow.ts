import { randomUUID } from "node:crypto"
import {
  createCandidateBranch,
  finalizeCandidateDecision,
} from "./core/repoSimulation.js"
import type {
  Item,
  ProjectContext,
  WithDocumentation,
  WorkflowContext,
} from "./types.js"
import { print } from "./print.js"
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

export async function runWorkflow(item: Item): Promise<void> {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const activeRun = getActiveRun()
  const context: WorkflowContext = {
    workspaceId: slug ? `${slug}-${item.id.toLowerCase()}` : item.id.toLowerCase(),
    runId: activeRun?.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
  }

  const projects = await withStageLifecycle("brainstorm", {}, () => brainstorm(item, context))
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
    await runProject({ ...context, project })
  }

  print.header("FERTIG")
  print.ok(`Item "${item.title}" ist done ✓`)
}

async function runProject(initialCtx: ProjectContext): Promise<void> {
  let ctx = initialCtx
  const projectId = ctx.project.id
  ctx = { ...ctx, prd: await withStageLifecycle("requirements", { projectId }, () => requirements(ctx)) }
  ctx = { ...ctx, architecture: await withStageLifecycle("architecture", { projectId }, () => architecture(assertWithPrd(ctx))) }
  ctx = { ...ctx, plan: await withStageLifecycle("planning", { projectId }, () => planning(assertWithArchitecture(ctx))) }
  ctx = { ...ctx, executionSummaries: await withStageLifecycle("execution", { projectId }, () => execution(assertWithPlan(ctx))) }
  ctx = { ...ctx, projectReview: await withStageLifecycle("project-review", { projectId }, () => projectReview(assertWithExecution(ctx))) }
  await withStageLifecycle("qa", { projectId }, () => qa(ctx))
  ctx = { ...ctx, documentation: await withStageLifecycle("documentation", { projectId }, () => documentation(assertWithProjectReview(ctx))) }
  await withStageLifecycle("handoff", { projectId }, () => handoffCandidate(assertWithDocumentation(ctx)))
}

async function handoffCandidate(ctx: WithDocumentation): Promise<void> {
  const handoff = await createCandidateBranch(ctx, ctx.project, ctx.documentation)
  print.header(`handoff — ${ctx.project.name}`)
  print.ok(handoff.summary)
  print.dim(`→ Candidate: ${handoff.candidateBranch.name}`)
  print.dim(`→ Base: ${handoff.candidateBranch.base}`)
  handoff.mergeChecklist.forEach(item => print.dim(`→ ${item}`))

  const decisionRaw = await ask("  Kandidat testen, mergen oder ablehnen? [test/merge/reject] > ")
  const decision = normalizeDecision(decisionRaw)
  const updated = await finalizeCandidateDecision(ctx, handoff, decision)
  print.ok(updated.summary)
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

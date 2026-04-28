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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { layout } from "./workspaceLayout.js";
import { architecture } from "../stages/architecture/index.js";
import { documentation } from "../stages/documentation/index.js";
import { execution } from "../stages/execution/index.js";
import { handoff } from "../stages/handoff/index.js";
import { planning } from "../stages/planning/index.js";
import { projectReview } from "../stages/project-review/index.js";
import { qa } from "../stages/qa/index.js";
import { requirements } from "../stages/requirements/index.js";
export const PROJECT_STAGE_ORDER = [
    "requirements",
    "architecture",
    "planning",
    "execution",
    "project-review",
    "qa",
    "documentation",
    "handoff",
];
export function shouldRunProjectStage(resume, stage) {
    if (!resume)
        return true;
    return PROJECT_STAGE_ORDER.indexOf(stage) >= PROJECT_STAGE_ORDER.indexOf(resume.startStage);
}
// ---------- invariants ----------
export function assertWithPrd(ctx) {
    if (!ctx.prd)
        throw new Error("Pipeline invariant violated: PRD missing");
    return ctx;
}
export function assertWithArchitecture(ctx) {
    if (!ctx.prd || !ctx.architecture) {
        throw new Error("Pipeline invariant violated: prd/architecture missing");
    }
    return ctx;
}
export function assertWithPlan(ctx) {
    if (!ctx.prd || !ctx.architecture || !ctx.plan) {
        throw new Error("Pipeline invariant violated: plan missing");
    }
    return ctx;
}
export function assertWithExecution(ctx) {
    if (!ctx.prd || !ctx.architecture || !ctx.plan || !ctx.executionSummaries) {
        throw new Error("Pipeline invariant violated: execution missing");
    }
    return ctx;
}
export function assertWithProjectReview(ctx) {
    if (!ctx.prd ||
        !ctx.architecture ||
        !ctx.plan ||
        !ctx.executionSummaries ||
        !ctx.projectReview) {
        throw new Error("Pipeline invariant violated: projectReview missing");
    }
    return ctx;
}
export function assertWithDocumentation(ctx) {
    if (!ctx.prd ||
        !ctx.architecture ||
        !ctx.plan ||
        !ctx.executionSummaries ||
        !ctx.projectReview ||
        !ctx.documentation) {
        throw new Error("Pipeline invariant violated: documentation missing");
    }
    return ctx;
}
// ---------- disk loaders ----------
async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}
async function loadPrd(ctx) {
    const artifact = await readJson(join(layout.stageArtifactsDir(ctx, "requirements"), "prd.json"));
    return artifact.prd;
}
async function loadArchitecture(ctx) {
    return readJson(join(layout.stageArtifactsDir(ctx, "architecture"), "architecture.json"));
}
async function loadPlan(ctx) {
    return readJson(join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"));
}
async function loadExecutionSummaries(ctx, plan) {
    return Promise.all(plan.plan.waves.map(wave => readJson(layout.waveSummaryFile(ctx, wave.number))));
}
async function loadProjectReview(ctx) {
    return readJson(join(layout.stageArtifactsDir(ctx, "project-review"), "project-review.json"));
}
async function loadDocumentation(ctx) {
    return readJson(join(layout.stageArtifactsDir(ctx, "documentation"), "documentation.json"));
}
// ---------- nodes ----------
const requirementsNode = {
    id: "requirements",
    run: async (ctx, deps) => ({ ...ctx, prd: await requirements(ctx, deps.llm?.stage) }),
    resumeFromDisk: async (ctx) => ({ ...ctx, prd: await loadPrd(ctx) }),
};
const architectureNode = {
    id: "architecture",
    run: async (ctx, deps) => ({
        ...ctx,
        architecture: await architecture(assertWithPrd(ctx), deps.llm?.stage),
    }),
    resumeFromDisk: async (ctx) => ({ ...ctx, architecture: await loadArchitecture(ctx) }),
};
const planningNode = {
    id: "planning",
    run: async (ctx, deps) => ({
        ...ctx,
        plan: await planning(assertWithArchitecture(ctx), deps.llm?.stage),
    }),
    resumeFromDisk: async (ctx) => ({ ...ctx, plan: await loadPlan(ctx) }),
};
const executionNode = {
    id: "execution",
    run: async (ctx, deps) => ({
        ...ctx,
        executionSummaries: await execution(assertWithPlan(ctx), deps.resume?.execution, deps.llm?.execution, deps.git),
    }),
    resumeFromDisk: async (ctx) => ({
        ...ctx,
        executionSummaries: await loadExecutionSummaries(ctx, assertWithPlan(ctx).plan),
    }),
};
const projectReviewNode = {
    id: "project-review",
    run: async (ctx, deps) => ({
        ...ctx,
        projectReview: await projectReview(assertWithExecution(ctx), deps.llm?.stage),
    }),
    resumeFromDisk: async (ctx) => ({ ...ctx, projectReview: await loadProjectReview(ctx) }),
};
const qaNode = {
    id: "qa",
    run: async (ctx, deps) => {
        await qa(ctx, deps.llm?.stage);
        return ctx;
    },
    // QA produces no context artifact; skipping = no-op.
    resumeFromDisk: async (ctx) => ctx,
};
const documentationNode = {
    id: "documentation",
    run: async (ctx, deps) => ({
        ...ctx,
        documentation: await documentation(assertWithProjectReview(ctx), deps.llm?.stage),
    }),
    resumeFromDisk: async (ctx) => ({ ...ctx, documentation: await loadDocumentation(ctx) }),
};
const handoffNode = {
    id: "handoff",
    // Handoff is the only stage that takes the GitAdapter as a positional
    // argument rather than reading it implicitly from `deps.git` inside its
    // own body. Most stages operate on persisted artifacts and never touch
    // git directly; handoff actively performs `git.mergeProjectIntoItem(...)`
    // and `git.assertWorkspaceRootOnBaseBranch(...)`, so making the
    // dependency explicit at the call site keeps its contract honest. The
    // registry wrapper threads `deps.git` in; the function signature itself
    // makes the git use visible to anyone reading stages/handoff/index.ts.
    run: async (ctx, deps) => {
        await handoff(assertWithDocumentation(ctx), deps.git);
        return ctx;
    },
    // Handoff produces no context artifact; skipping = no-op.
    resumeFromDisk: async (ctx) => ctx,
};
/**
 * The full per-project pipeline in execution order. Adding/removing/
 * reordering a stage is a registry edit, not a control-flow rewrite.
 */
export const PROJECT_STAGE_REGISTRY = [
    requirementsNode,
    architectureNode,
    planningNode,
    executionNode,
    projectReviewNode,
    qaNode,
    documentationNode,
    handoffNode,
];

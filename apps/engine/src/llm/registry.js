import { emitEvent, getActiveRun } from "../core/runContext.js";
import { reviewerPolicy, stageAuthoringPolicy } from "./runtimePolicy.js";
import presetsJson from "../core/harness/presets.json" with { type: "json" };
import { FakeBrainstormReviewAdapter } from "./fake/brainstormReview.js";
import { FakeBrainstormStageAdapter } from "./fake/brainstormStage.js";
import { FakeArchitectureReviewAdapter } from "./fake/architectureReview.js";
import { FakeArchitectureStageAdapter } from "./fake/architectureStage.js";
import { FakeDocumentationReviewAdapter } from "./fake/documentationReview.js";
import { FakeDocumentationStageAdapter } from "./fake/documentationStage.js";
import { FakePlanningReviewAdapter } from "./fake/planningReview.js";
import { FakePlanningStageAdapter } from "./fake/planningStage.js";
import { FakeProjectReviewReviewAdapter } from "./fake/projectReviewReview.js";
import { FakeProjectReviewStageAdapter } from "./fake/projectReviewStage.js";
import { FakeQaReviewAdapter } from "./fake/qaReview.js";
import { FakeQaStageAdapter } from "./fake/qaStage.js";
import { FakeRequirementsReviewAdapter } from "./fake/requirementsReview.js";
import { FakeRequirementsStageAdapter } from "./fake/requirementsStage.js";
import { FakeVisualCompanionReviewAdapter } from "./fake/visualCompanionReview.js";
import { FakeVisualCompanionStageAdapter } from "./fake/visualCompanionStage.js";
import { FakeFrontendDesignReviewAdapter } from "./fake/frontendDesignReview.js";
import { FakeFrontendDesignStageAdapter } from "./fake/frontendDesignStage.js";
import { FakeTestWriterReviewAdapter } from "./fake/testWriterReview.js";
import { FakeTestWriterStageAdapter } from "./fake/testWriterStage.js";
import { HostedReviewAdapter, HostedStageAdapter } from "./hosted/hostedCliAdapter.js";
export { executionCoderPolicy } from "./runtimePolicy.js";
/**
 * Map the harness brand id (`KnownHarness`) used in workspace config and
 * presets to the legacy `ProviderId` value still consumed by a few external
 * call sites (mergeResolver telemetry, etc.).
 */
export function harnessToLegacyProviderId(harness) {
    switch (harness) {
        case "claude":
            return "claude-code";
        case "codex":
            return "codex";
        case "opencode":
            return "opencode";
    }
}
const PRESETS = presetsJson.presets;
function resolveFromPreset(presetKey, role, stage, workspaceRoot) {
    const preset = PRESETS[presetKey];
    if (!preset)
        throw new Error(`Unknown preset key "${presetKey}"`);
    // Roles new to the schema (e.g. "merge-resolver") may be absent from older
    // preset files. Fall back to the coder role so mainline runs keep working.
    const entry = preset[role] ?? preset.coder;
    if (entry.harness === "opencode") {
        throw new Error(`Preset "${presetKey}" resolves to opencode for role "${role}", which is not implemented yet`);
    }
    const runtime = entry.runtime ?? "cli";
    // Execution stage writes real code and needs the strongest coder model,
    // while design-prep / requirements / planning stages are text generation
    // where a faster mid-tier model is plenty. Upgrade Sonnet -> Opus just for
    // execution-coder on Claude-family presets.
    let model = entry.model;
    if (stage === "execution" && role === "coder" && entry.harness === "claude" && model === "claude-sonnet-4-6") {
        model = "claude-opus-4-7";
    }
    return { kind: "hosted", harness: entry.harness, provider: entry.provider, runtime, model, workspaceRoot };
}
/**
 * Resolve the harness used to fix wave-merge conflicts. Mirrors
 * `resolveHarness` for stage agents but is named so call sites read clearly.
 * Falls back to the coder harness if the active preset / self-config does
 * not declare a `merge-resolver` entry.
 */
export function resolveMergeResolverHarness(llm) {
    return resolveHarness({ ...llm, role: "merge-resolver", stage: "execution" });
}
export function resolveHarness(input) {
    if (input.testingOverride === "fake" || process.env.BEERENGINEER_FORCE_FAKE_LLM === "1") {
        return { kind: "fake", workspaceRoot: input.workspaceRoot };
    }
    switch (input.harnessProfile.mode) {
        case "claude-only":
        case "claude-first":
        case "codex-only":
        case "codex-first":
        case "fast":
        case "claude-sdk-first":
        case "codex-sdk-first":
            return resolveFromPreset(input.harnessProfile.mode, input.role, input.stage, input.workspaceRoot);
        case "opencode":
        case "opencode-china":
        case "opencode-euro":
            throw new Error(`Harness profile mode "${input.harnessProfile.mode}" is not implemented yet`);
        case "self": {
            const roles = input.harnessProfile.roles;
            const selected = roles[input.role] ?? roles.coder;
            if (selected.harness === "opencode") {
                throw new Error('Harness profile resolves to "opencode", which is not implemented yet');
            }
            const runtime = selected.runtime ?? "cli";
            return {
                kind: "hosted",
                harness: selected.harness,
                provider: selected.provider ?? "",
                runtime,
                model: selected.model,
                workspaceRoot: input.workspaceRoot,
            };
        }
    }
}
function logResolution(stage, role, harness, policy) {
    const run = getActiveRun();
    if (!run)
        return;
    if (harness.kind === "fake") {
        emitEvent({
            type: "log",
            runId: run.runId,
            message: `llm.resolve stage=${stage} role=${role} provider=fake policy=${policy.mode}`,
        });
        return;
    }
    emitEvent({
        type: "log",
        runId: run.runId,
        message: `llm.resolve stage=${stage} role=${role} harness=${harness.harness} runtime=${harness.runtime} provider=${harness.provider} model=${harness.model ?? "default"} policy=${policy.mode}`,
    });
}
function createHostedStageAdapter(stage, llm) {
    const harness = resolveHarness({ ...llm, role: "coder", stage });
    if (harness.kind === "fake") {
        throw new Error(`Stage ${stage} requested fake provider via hosted path`);
    }
    const policy = stageAuthoringPolicy(llm.runtimePolicy, stage);
    logResolution(stage, "coder", harness, policy);
    return new HostedStageAdapter({
        stageId: stage,
        harness: harness.harness,
        runtime: harness.runtime,
        provider: harness.provider,
        model: harness.model,
        workspaceRoot: llm.workspaceRoot,
        runtimePolicy: policy,
    });
}
function createHostedReviewAdapter(stage, llm) {
    const harness = resolveHarness({ ...llm, role: "reviewer", stage });
    if (harness.kind === "fake") {
        throw new Error(`Stage ${stage} requested fake provider via hosted path`);
    }
    const policy = reviewerPolicy(llm.runtimePolicy, stage);
    logResolution(stage, "reviewer", harness, policy);
    return new HostedReviewAdapter({
        stageId: stage,
        harness: harness.harness,
        runtime: harness.runtime,
        provider: harness.provider,
        model: harness.model,
        workspaceRoot: llm.workspaceRoot,
        runtimePolicy: policy,
    });
}
const LLM_STAGE_REGISTRY = {
    brainstorm: { fakeStage: () => new FakeBrainstormStageAdapter(), fakeReview: () => new FakeBrainstormReviewAdapter() },
    "visual-companion": { fakeStage: () => new FakeVisualCompanionStageAdapter(), fakeReview: () => new FakeVisualCompanionReviewAdapter() },
    "frontend-design": { fakeStage: () => new FakeFrontendDesignStageAdapter(), fakeReview: () => new FakeFrontendDesignReviewAdapter() },
    requirements: { fakeStage: () => new FakeRequirementsStageAdapter(), fakeReview: () => new FakeRequirementsReviewAdapter() },
    architecture: { fakeStage: p => new FakeArchitectureStageAdapter(p), fakeReview: () => new FakeArchitectureReviewAdapter() },
    planning: { fakeStage: p => new FakePlanningStageAdapter(p), fakeReview: () => new FakePlanningReviewAdapter() },
    documentation: { fakeStage: p => new FakeDocumentationStageAdapter(p), fakeReview: () => new FakeDocumentationReviewAdapter() },
    "project-review": { fakeStage: p => new FakeProjectReviewStageAdapter(p), fakeReview: () => new FakeProjectReviewReviewAdapter() },
    "test-writer": { fakeStage: p => new FakeTestWriterStageAdapter(p), fakeReview: () => new FakeTestWriterReviewAdapter() },
    qa: { fakeStage: () => new FakeQaStageAdapter(), fakeReview: () => new FakeQaReviewAdapter() },
};
/**
 * Generic stage-adapter constructor — picks the hosted path when an
 * `llm` config is supplied, otherwise falls back to the fake adapter
 * registered for {@link stageId}. Caller-supplied generics narrow the
 * return type.
 */
export function createStageAdapter(stageId, llm, project) {
    if (llm)
        return createHostedStageAdapter(stageId, llm);
    return LLM_STAGE_REGISTRY[stageId].fakeStage(project);
}
/**
 * Generic review-adapter constructor — symmetric to
 * {@link createStageAdapter}, for the reviewer role.
 */
export function createReviewAdapter(stageId, llm) {
    if (llm)
        return createHostedReviewAdapter(stageId, llm);
    return LLM_STAGE_REGISTRY[stageId].fakeReview();
}
// ---------- narrow factory exports ----------
// Each is a one-liner over the generics above; kept so consumer modules
// can import a strongly-typed factory per stage without supplying type
// arguments at the call site.
export const createBrainstormStage = (_project, llm) => createStageAdapter("brainstorm", llm);
export const createBrainstormReview = (llm) => createReviewAdapter("brainstorm", llm);
export const createVisualCompanionStage = (llm) => createStageAdapter("visual-companion", llm);
export const createVisualCompanionReview = (llm) => createReviewAdapter("visual-companion", llm);
export const createFrontendDesignStage = (llm) => createStageAdapter("frontend-design", llm);
export const createFrontendDesignReview = (llm) => createReviewAdapter("frontend-design", llm);
export const createRequirementsStage = (llm) => createStageAdapter("requirements", llm);
export const createRequirementsReview = (llm) => createReviewAdapter("requirements", llm);
export const createArchitectureStage = (project, llm) => createStageAdapter("architecture", llm, project);
export const createArchitectureReview = (llm) => createReviewAdapter("architecture", llm);
export const createPlanningStage = (project, llm) => createStageAdapter("planning", llm, project);
export const createPlanningReview = (llm) => createReviewAdapter("planning", llm);
export const createDocumentationStage = (project, llm) => createStageAdapter("documentation", llm, project);
export const createDocumentationReview = (llm) => createReviewAdapter("documentation", llm);
export const createProjectReviewStage = (project, llm) => createStageAdapter("project-review", llm, project);
export const createProjectReviewReview = (llm) => createReviewAdapter("project-review", llm);
export const createTestWriterStage = (project, llm) => createStageAdapter("test-writer", llm, project);
export const createTestWriterReview = (llm) => createReviewAdapter("test-writer", llm);
export const createQaStage = (llm) => createStageAdapter("qa", llm);
export const createQaReview = (llm) => createReviewAdapter("qa", llm);

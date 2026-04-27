import type { InvocationRuntime, ProviderId } from "./types.js"
import type { ReviewAgentAdapter, StageAgentAdapter } from "../core/adapters.js"
import { emitEvent, getActiveRun } from "../core/runContext.js"
import type { HarnessProfile, HarnessRole, KnownHarness, WorkspaceRuntimePolicy } from "../types/workspace.js"
import { reviewerPolicy, stageAuthoringPolicy, type RuntimePolicy } from "./runtimePolicy.js"
import presetsJson from "../core/harness/presets.json" with { type: "json" }

import { FakeBrainstormReviewAdapter } from "./fake/brainstormReview.js"
import { FakeBrainstormStageAdapter } from "./fake/brainstormStage.js"
import { FakeArchitectureReviewAdapter } from "./fake/architectureReview.js"
import { FakeArchitectureStageAdapter } from "./fake/architectureStage.js"
import { FakeDocumentationReviewAdapter } from "./fake/documentationReview.js"
import { FakeDocumentationStageAdapter } from "./fake/documentationStage.js"
import { FakePlanningReviewAdapter } from "./fake/planningReview.js"
import { FakePlanningStageAdapter } from "./fake/planningStage.js"
import { FakeProjectReviewReviewAdapter } from "./fake/projectReviewReview.js"
import { FakeProjectReviewStageAdapter } from "./fake/projectReviewStage.js"
import { FakeQaReviewAdapter } from "./fake/qaReview.js"
import { FakeQaStageAdapter } from "./fake/qaStage.js"
import { FakeRequirementsReviewAdapter } from "./fake/requirementsReview.js"
import { FakeRequirementsStageAdapter } from "./fake/requirementsStage.js"
import { FakeVisualCompanionReviewAdapter } from "./fake/visualCompanionReview.js"
import { FakeVisualCompanionStageAdapter } from "./fake/visualCompanionStage.js"
import { FakeFrontendDesignReviewAdapter } from "./fake/frontendDesignReview.js"
import { FakeFrontendDesignStageAdapter } from "./fake/frontendDesignStage.js"
import { FakeTestWriterReviewAdapter } from "./fake/testWriterReview.js"
import { FakeTestWriterStageAdapter } from "./fake/testWriterStage.js"

import type { ArchitectureArtifact, ArchitectureState } from "../stages/architecture/types.js"
import type { BrainstormArtifact, BrainstormState } from "../stages/brainstorm/types.js"
import type { DocumentationArtifact, DocumentationState } from "../stages/documentation/types.js"
import type { StoryTestPlanArtifact, TestWriterState } from "../stages/execution/types.js"
import type { DesignArtifact, FrontendDesignState } from "../stages/frontend-design/types.js"
import type { ImplementationPlanArtifact, PlanningState } from "../stages/planning/types.js"
import type { ProjectReviewArtifact, ProjectReviewState } from "../stages/project-review/types.js"
import type { QaArtifact, QaState } from "../stages/qa/types.js"
import type { RequirementsArtifact, RequirementsState } from "../stages/requirements/types.js"
import type { VisualCompanionState, WireframeArtifact } from "../stages/visual-companion/types.js"
import type { Project } from "../types/domain.js"
import { HostedReviewAdapter, HostedStageAdapter } from "./hosted/hostedCliAdapter.js"

export type { RuntimePolicy } from "./runtimePolicy.js"
export { executionCoderPolicy } from "./runtimePolicy.js"

/**
 * Outcome of `resolveHarness`. Three orthogonal axes:
 *   - `harness`  → agent runtime brand (claude | codex | opencode)
 *   - `provider` → API vendor (anthropic | openai | openrouter | …)
 *   - `runtime`  → invocation mechanism (cli | sdk)
 *
 * The fake variant is split into its own arm so provider/runtime dispatch in
 * the hosted layer never has to special-case it.
 */
export type ResolvedHarness =
  | { kind: "fake"; workspaceRoot: string }
  | {
      kind: "hosted"
      harness: KnownHarness
      provider: string
      runtime: InvocationRuntime
      model?: string
      workspaceRoot: string
    }

export type RunLlmConfig = {
  workspaceRoot: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  testingOverride?: "fake"
}

export type StageId =
  | "brainstorm"
  | "visual-companion"
  | "frontend-design"
  | "requirements"
  | "architecture"
  | "planning"
  | "documentation"
  | "project-review"
  | "test-writer"
  | "qa"
  | "execution"

type RealProviderId = Exclude<ProviderId, "fake">

/**
 * Map the harness brand id (`KnownHarness`) used in workspace config and
 * presets to the legacy `ProviderId` value still consumed by a few external
 * call sites (mergeResolver telemetry, etc.).
 */
export function harnessToLegacyProviderId(harness: KnownHarness): RealProviderId {
  switch (harness) {
    case "claude":
      return "claude-code"
    case "codex":
      return "codex"
    case "opencode":
      return "opencode"
  }
}

type AdapterFactoryInput = {
  workspaceRoot: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  role: HarnessRole
  stage: StageId
  testingOverride?: "fake"
}

type PresetRoleEntry = {
  harness: KnownHarness
  provider: string
  model?: string
  /** Defaults to "cli" when absent. */
  runtime?: InvocationRuntime
}
type PresetEntry = {
  coder: PresetRoleEntry
  reviewer: PresetRoleEntry
  // Optional so older / external preset files keep loading; resolveFromPreset
  // falls back to `coder` when a role is missing.
  "merge-resolver"?: PresetRoleEntry
}
const PRESETS = (presetsJson as { presets: Record<string, PresetEntry> }).presets

function resolveFromPreset(presetKey: string, role: HarnessRole, stage: StageId, workspaceRoot: string): ResolvedHarness {
  const preset = PRESETS[presetKey]
  if (!preset) throw new Error(`Unknown preset key "${presetKey}"`)
  // Roles new to the schema (e.g. "merge-resolver") may be absent from older
  // preset files. Fall back to the coder role so mainline runs keep working.
  const entry = preset[role] ?? preset.coder
  if (entry.harness === "opencode") {
    throw new Error(`Preset "${presetKey}" resolves to opencode for role "${role}", which is not implemented yet`)
  }
  const runtime: InvocationRuntime = entry.runtime ?? "cli"
  // Execution stage writes real code and needs the strongest coder model,
  // while design-prep / requirements / planning stages are text generation
  // where a faster mid-tier model is plenty. Upgrade Sonnet -> Opus just for
  // execution-coder on Claude-family presets.
  let model = entry.model
  if (stage === "execution" && role === "coder" && entry.harness === "claude" && model === "claude-sonnet-4-6") {
    model = "claude-opus-4-7"
  }
  return { kind: "hosted", harness: entry.harness, provider: entry.provider, runtime, model, workspaceRoot }
}

/**
 * Resolve the harness used to fix wave-merge conflicts. Mirrors
 * `resolveHarness` for stage agents but is named so call sites read clearly.
 * Falls back to the coder harness if the active preset / self-config does
 * not declare a `merge-resolver` entry.
 */
export function resolveMergeResolverHarness(llm: RunLlmConfig): ResolvedHarness {
  return resolveHarness({ ...llm, role: "merge-resolver", stage: "execution" })
}

export function resolveHarness(input: AdapterFactoryInput): ResolvedHarness {
  if (input.testingOverride === "fake" || process.env.BEERENGINEER_FORCE_FAKE_LLM === "1") {
    return { kind: "fake", workspaceRoot: input.workspaceRoot }
  }
  switch (input.harnessProfile.mode) {
    case "claude-only":
    case "claude-first":
    case "codex-only":
    case "codex-first":
    case "fast":
    case "claude-sdk-first":
    case "codex-sdk-first":
      return resolveFromPreset(input.harnessProfile.mode, input.role, input.stage, input.workspaceRoot)
    case "opencode":
    case "opencode-china":
    case "opencode-euro":
      throw new Error(`Harness profile mode "${input.harnessProfile.mode}" is not implemented yet`)
    case "self": {
      const roles = input.harnessProfile.roles as Record<
        string,
        { harness: KnownHarness; provider?: string; model?: string; runtime?: InvocationRuntime }
      >
      const selected = roles[input.role] ?? roles.coder
      if (selected.harness === "opencode") {
        throw new Error('Harness profile resolves to "opencode", which is not implemented yet')
      }
      const runtime: InvocationRuntime = selected.runtime ?? "cli"
      return {
        kind: "hosted",
        harness: selected.harness,
        provider: selected.provider ?? "",
        runtime,
        model: selected.model,
        workspaceRoot: input.workspaceRoot,
      }
    }
  }
}

function logResolution(stage: StageId, role: HarnessRole, harness: ResolvedHarness, policy: RuntimePolicy): void {
  const run = getActiveRun()
  if (!run) return
  if (harness.kind === "fake") {
    emitEvent({
      type: "log",
      runId: run.runId,
      message: `llm.resolve stage=${stage} role=${role} provider=fake policy=${policy.mode}`,
    })
    return
  }
  emitEvent({
    type: "log",
    runId: run.runId,
    message: `llm.resolve stage=${stage} role=${role} harness=${harness.harness} runtime=${harness.runtime} provider=${harness.provider} model=${harness.model ?? "default"} policy=${policy.mode}`,
  })
}

function createHostedStageAdapter<S, A>(stage: StageId, llm: RunLlmConfig): StageAgentAdapter<S, A> {
  const harness = resolveHarness({ ...llm, role: "coder", stage })
  if (harness.kind === "fake") {
    throw new Error(`Stage ${stage} requested fake provider via hosted path`)
  }
  const policy = stageAuthoringPolicy(llm.runtimePolicy, stage)
  logResolution(stage, "coder", harness, policy)
  return new HostedStageAdapter<S, A>({
    stageId: stage,
    harness: harness.harness,
    runtime: harness.runtime,
    provider: harness.provider,
    model: harness.model,
    workspaceRoot: llm.workspaceRoot,
    runtimePolicy: policy,
  })
}

function createHostedReviewAdapter<S, A>(stage: StageId, llm: RunLlmConfig): ReviewAgentAdapter<S, A> {
  const harness = resolveHarness({ ...llm, role: "reviewer", stage })
  if (harness.kind === "fake") {
    throw new Error(`Stage ${stage} requested fake provider via hosted path`)
  }
  const policy = reviewerPolicy(llm.runtimePolicy, stage)
  logResolution(stage, "reviewer", harness, policy)
  return new HostedReviewAdapter<S, A>({
    stageId: stage,
    harness: harness.harness,
    runtime: harness.runtime,
    provider: harness.provider,
    model: harness.model,
    workspaceRoot: llm.workspaceRoot,
    runtimePolicy: policy,
  })
}

/**
 * Single source of truth for per-stage LLM adapter wiring.
 *
 * Each entry owns the fake-adapter constructors for its stage. The hosted
 * path is stage-agnostic and shared via {@link createHostedStageAdapter}
 * / {@link createHostedReviewAdapter} above.
 *
 * Adding a new LLM-using stage means:
 *   1. Add its StageId to the union (in `./types`).
 *   2. Add one entry to this registry.
 *   3. (Optional) Add a narrow `createXxxStage/Review` export at the
 *      bottom for type-narrow consumer use; it's a one-liner.
 *
 * Replaces the previous FAKE_STAGES table + 18 hand-rolled factory
 * functions: one place to register a stage, generic helpers to create
 * adapters, narrow exports that delegate via the helpers.
 */
type LlmStageEntry<S, A> = {
  fakeStage: (project?: Project) => StageAgentAdapter<S, A>
  fakeReview: () => ReviewAgentAdapter<S, A>
}

// `any` here is unavoidable: the registry holds adapters with stage-specific
// (S, A) types under one keyed object. Variance prevents expressing this with
// `unknown`. The narrow factory exports below cast back to the correct type
// using stage-specific generics, restoring type safety at the consumer boundary.
type AnyEntry = LlmStageEntry<any, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * StageIds with LLM stage/review adapters. The "execution" stage has no
 * stage-agent adapter — it owns the Ralph runtime (loop + coder harness)
 * and a per-story test-writer agent (under "test-writer") instead.
 */
export type LlmStageId = Exclude<StageId, "execution">

const LLM_STAGE_REGISTRY: Record<LlmStageId, AnyEntry> = {
  brainstorm:      { fakeStage: () => new FakeBrainstormStageAdapter(),    fakeReview: () => new FakeBrainstormReviewAdapter() },
  "visual-companion": { fakeStage: () => new FakeVisualCompanionStageAdapter(), fakeReview: () => new FakeVisualCompanionReviewAdapter() },
  "frontend-design": { fakeStage: () => new FakeFrontendDesignStageAdapter(), fakeReview: () => new FakeFrontendDesignReviewAdapter() },
  requirements:    { fakeStage: () => new FakeRequirementsStageAdapter(),  fakeReview: () => new FakeRequirementsReviewAdapter() },
  architecture:    { fakeStage: p => new FakeArchitectureStageAdapter(p!),  fakeReview: () => new FakeArchitectureReviewAdapter() },
  planning:        { fakeStage: p => new FakePlanningStageAdapter(p!),      fakeReview: () => new FakePlanningReviewAdapter() },
  documentation:   { fakeStage: p => new FakeDocumentationStageAdapter(p!), fakeReview: () => new FakeDocumentationReviewAdapter() },
  "project-review":{ fakeStage: p => new FakeProjectReviewStageAdapter(p!), fakeReview: () => new FakeProjectReviewReviewAdapter() },
  "test-writer":   { fakeStage: p => new FakeTestWriterStageAdapter(p!),    fakeReview: () => new FakeTestWriterReviewAdapter() },
  qa:              { fakeStage: () => new FakeQaStageAdapter(),            fakeReview: () => new FakeQaReviewAdapter() },
}

/**
 * Generic stage-adapter constructor — picks the hosted path when an
 * `llm` config is supplied, otherwise falls back to the fake adapter
 * registered for {@link stageId}. Caller-supplied generics narrow the
 * return type.
 */
export function createStageAdapter<S, A>(
  stageId: LlmStageId,
  llm: RunLlmConfig | undefined,
  project?: Project,
): StageAgentAdapter<S, A> {
  if (llm) return createHostedStageAdapter<S, A>(stageId, llm)
  return LLM_STAGE_REGISTRY[stageId].fakeStage(project) as StageAgentAdapter<S, A>
}

/**
 * Generic review-adapter constructor — symmetric to
 * {@link createStageAdapter}, for the reviewer role.
 */
export function createReviewAdapter<S, A>(
  stageId: LlmStageId,
  llm: RunLlmConfig | undefined,
): ReviewAgentAdapter<S, A> {
  if (llm) return createHostedReviewAdapter<S, A>(stageId, llm)
  return LLM_STAGE_REGISTRY[stageId].fakeReview() as ReviewAgentAdapter<S, A>
}

// ---------- narrow factory exports ----------
// Each is a one-liner over the generics above; kept so consumer modules
// can import a strongly-typed factory per stage without supplying type
// arguments at the call site.

export const createBrainstormStage = (_project: Project | undefined, llm?: RunLlmConfig) =>
  createStageAdapter<BrainstormState, BrainstormArtifact>("brainstorm", llm)
export const createBrainstormReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<BrainstormState, BrainstormArtifact>("brainstorm", llm)

export const createVisualCompanionStage = (llm?: RunLlmConfig) =>
  createStageAdapter<VisualCompanionState, WireframeArtifact>("visual-companion", llm)
export const createVisualCompanionReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<VisualCompanionState, WireframeArtifact>("visual-companion", llm)

export const createFrontendDesignStage = (llm?: RunLlmConfig) =>
  createStageAdapter<FrontendDesignState, DesignArtifact>("frontend-design", llm)
export const createFrontendDesignReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<FrontendDesignState, DesignArtifact>("frontend-design", llm)

export const createRequirementsStage = (llm?: RunLlmConfig) =>
  createStageAdapter<RequirementsState, RequirementsArtifact>("requirements", llm)
export const createRequirementsReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<RequirementsState, RequirementsArtifact>("requirements", llm)

export const createArchitectureStage = (project: Project, llm?: RunLlmConfig) =>
  createStageAdapter<ArchitectureState, ArchitectureArtifact>("architecture", llm, project)
export const createArchitectureReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<ArchitectureState, ArchitectureArtifact>("architecture", llm)

export const createPlanningStage = (project: Project, llm?: RunLlmConfig) =>
  createStageAdapter<PlanningState, ImplementationPlanArtifact>("planning", llm, project)
export const createPlanningReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<PlanningState, ImplementationPlanArtifact>("planning", llm)

export const createDocumentationStage = (project: Project, llm?: RunLlmConfig) =>
  createStageAdapter<DocumentationState, DocumentationArtifact>("documentation", llm, project)
export const createDocumentationReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<DocumentationState, DocumentationArtifact>("documentation", llm)

export const createProjectReviewStage = (project: Project, llm?: RunLlmConfig) =>
  createStageAdapter<ProjectReviewState, ProjectReviewArtifact>("project-review", llm, project)
export const createProjectReviewReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<ProjectReviewState, ProjectReviewArtifact>("project-review", llm)

export const createTestWriterStage = (project: Project, llm?: RunLlmConfig) =>
  createStageAdapter<TestWriterState, StoryTestPlanArtifact>("test-writer", llm, project)
export const createTestWriterReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<TestWriterState, StoryTestPlanArtifact>("test-writer", llm)

export const createQaStage = (llm?: RunLlmConfig) =>
  createStageAdapter<QaState, QaArtifact>("qa", llm)
export const createQaReview = (llm?: RunLlmConfig) =>
  createReviewAdapter<QaState, QaArtifact>("qa", llm)

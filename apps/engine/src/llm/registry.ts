import type { ProviderId } from "./types.js"
import type { ReviewAgentAdapter, StageAgentAdapter } from "../core/adapters.js"
import { emitEvent, getActiveRun } from "../core/runContext.js"
import type { HarnessProfile, HarnessRole, WorkspaceRuntimePolicy } from "../types/workspace.js"
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

export type ResolvedHarness = {
  harness: ProviderId
  provider: ProviderId
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

function toProviderId(harness: "claude" | "codex" | "opencode"): RealProviderId {
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

type PresetRoleEntry = { harness: "claude" | "codex" | "opencode"; provider: string; model?: string }
type PresetEntry = { coder: PresetRoleEntry; reviewer: PresetRoleEntry }
const PRESETS = (presetsJson as { presets: Record<string, PresetEntry> }).presets

function resolveFromPreset(presetKey: string, role: HarnessRole, stage: StageId, workspaceRoot: string): ResolvedHarness {
  const preset = PRESETS[presetKey]
  if (!preset) throw new Error(`Unknown preset key "${presetKey}"`)
  const entry = preset[role]
  const provider = toProviderId(entry.harness)
  if (provider === "opencode") {
    throw new Error(`Preset "${presetKey}" resolves to opencode for role "${role}", which is not implemented yet`)
  }
  // Execution stage writes real code and needs the strongest coder model,
  // while design-prep / requirements / planning stages are text generation
  // where a faster mid-tier model is plenty. Upgrade Sonnet -> Opus just for
  // execution-coder on Claude-family presets.
  let model = entry.model
  if (stage === "execution" && role === "coder" && provider === "claude-code" && model === "claude-sonnet-4-6") {
    model = "claude-opus-4-7"
  }
  return { harness: provider, provider, model, workspaceRoot }
}

export function resolveHarness(input: AdapterFactoryInput): ResolvedHarness {
  if (input.testingOverride === "fake" || process.env.BEERENGINEER_FORCE_FAKE_LLM === "1") {
    return { harness: "fake", provider: "fake", workspaceRoot: input.workspaceRoot }
  }
  switch (input.harnessProfile.mode) {
    case "claude-only":
    case "claude-first":
    case "codex-only":
    case "codex-first":
    case "fast":
      return resolveFromPreset(input.harnessProfile.mode, input.role, input.stage, input.workspaceRoot)
    case "opencode":
    case "opencode-china":
    case "opencode-euro":
      throw new Error(`Harness profile mode "${input.harnessProfile.mode}" is not implemented yet`)
    case "self": {
      const selected = input.harnessProfile.roles[input.role]
      const provider = toProviderId(selected.harness)
      if (provider === "opencode") {
        throw new Error('Harness profile resolves to "opencode", which is not implemented yet')
      }
      return { harness: provider, provider, model: selected.model, workspaceRoot: input.workspaceRoot }
    }
  }
}

function logResolution(stage: StageId, role: HarnessRole, harness: ResolvedHarness, policy: RuntimePolicy): void {
  const run = getActiveRun()
  if (!run) return
  emitEvent({
    type: "log",
    runId: run.runId,
    message: `llm.resolve stage=${stage} role=${role} provider=${harness.provider} model=${harness.model ?? "default"} policy=${policy.mode}`,
  })
}

function createHostedStageAdapter<S, A>(stage: StageId, llm: RunLlmConfig): StageAgentAdapter<S, A> {
  const harness = resolveHarness({ ...llm, role: "coder", stage })
  if (harness.provider === "fake") {
    throw new Error(`Stage ${stage} requested fake provider via hosted path`)
  }
  const provider = harness.provider as RealProviderId
  const policy = stageAuthoringPolicy(llm.runtimePolicy)
  logResolution(stage, "coder", harness, policy)
  return new HostedStageAdapter<S, A>({
    stageId: stage,
    provider,
    model: harness.model,
    workspaceRoot: llm.workspaceRoot,
    runtimePolicy: policy,
  })
}

function createHostedReviewAdapter<S, A>(stage: StageId, llm: RunLlmConfig): ReviewAgentAdapter<S, A> {
  const harness = resolveHarness({ ...llm, role: "reviewer", stage })
  if (harness.provider === "fake") {
    throw new Error(`Stage ${stage} requested fake provider via hosted path`)
  }
  const provider = harness.provider as RealProviderId
  const policy = reviewerPolicy(llm.runtimePolicy)
  logResolution(stage, "reviewer", harness, policy)
  return new HostedReviewAdapter<S, A>({
    stageId: stage,
    provider,
    model: harness.model,
    workspaceRoot: llm.workspaceRoot,
    runtimePolicy: policy,
  })
}

/**
 * Per-stage adapter table. Each entry owns the fake-adapter constructors for
 * its stage; the hosted path is stage-agnostic and handled by the two
 * `createHostedXxxAdapter` helpers above.
 *
 * Adding a new stage:
 *   1. Add its StageId to the union.
 *   2. Add an entry here mapping to the Fake* classes.
 *   3. Add the narrow `createXxxStage/Review` exports below if the stage
 *      needs extra construction args (e.g. a Project).
 */
type FakeStageFactory<S, A> = (...args: never[]) => StageAgentAdapter<S, A>
type FakeReviewFactory<S, A> = () => ReviewAgentAdapter<S, A>

const FAKE_STAGES: {
  brainstorm: { stage: FakeStageFactory<BrainstormState, BrainstormArtifact>; review: FakeReviewFactory<BrainstormState, BrainstormArtifact> }
  "visual-companion": { stage: FakeStageFactory<VisualCompanionState, WireframeArtifact>; review: FakeReviewFactory<VisualCompanionState, WireframeArtifact> }
  "frontend-design": { stage: FakeStageFactory<FrontendDesignState, DesignArtifact>; review: FakeReviewFactory<FrontendDesignState, DesignArtifact> }
  requirements: { stage: FakeStageFactory<RequirementsState, RequirementsArtifact>; review: FakeReviewFactory<RequirementsState, RequirementsArtifact> }
  architecture: { stage: (project: Project) => StageAgentAdapter<ArchitectureState, ArchitectureArtifact>; review: FakeReviewFactory<ArchitectureState, ArchitectureArtifact> }
  planning: { stage: (project: Project) => StageAgentAdapter<PlanningState, ImplementationPlanArtifact>; review: FakeReviewFactory<PlanningState, ImplementationPlanArtifact> }
  documentation: { stage: (project: Project) => StageAgentAdapter<DocumentationState, DocumentationArtifact>; review: FakeReviewFactory<DocumentationState, DocumentationArtifact> }
  "project-review": { stage: (project: Project) => StageAgentAdapter<ProjectReviewState, ProjectReviewArtifact>; review: FakeReviewFactory<ProjectReviewState, ProjectReviewArtifact> }
  "test-writer": { stage: (project: Project) => StageAgentAdapter<TestWriterState, StoryTestPlanArtifact>; review: FakeReviewFactory<TestWriterState, StoryTestPlanArtifact> }
  qa: { stage: FakeStageFactory<QaState, QaArtifact>; review: FakeReviewFactory<QaState, QaArtifact> }
} = {
  brainstorm:      { stage: () => new FakeBrainstormStageAdapter(),    review: () => new FakeBrainstormReviewAdapter() },
  "visual-companion": { stage: () => new FakeVisualCompanionStageAdapter(), review: () => new FakeVisualCompanionReviewAdapter() },
  "frontend-design": { stage: () => new FakeFrontendDesignStageAdapter(), review: () => new FakeFrontendDesignReviewAdapter() },
  requirements:    { stage: () => new FakeRequirementsStageAdapter(),  review: () => new FakeRequirementsReviewAdapter() },
  architecture:    { stage: p => new FakeArchitectureStageAdapter(p),  review: () => new FakeArchitectureReviewAdapter() },
  planning:        { stage: p => new FakePlanningStageAdapter(p),      review: () => new FakePlanningReviewAdapter() },
  documentation:   { stage: p => new FakeDocumentationStageAdapter(p), review: () => new FakeDocumentationReviewAdapter() },
  "project-review":{ stage: p => new FakeProjectReviewStageAdapter(p), review: () => new FakeProjectReviewReviewAdapter() },
  "test-writer":   { stage: p => new FakeTestWriterStageAdapter(p),    review: () => new FakeTestWriterReviewAdapter() },
  qa:              { stage: () => new FakeQaStageAdapter(),            review: () => new FakeQaReviewAdapter() },
}

export function createBrainstormStage(_project: Project | undefined, llm?: RunLlmConfig): StageAgentAdapter<BrainstormState, BrainstormArtifact> {
  return llm ? createHostedStageAdapter("brainstorm", llm) : FAKE_STAGES.brainstorm.stage()
}
export function createBrainstormReview(llm?: RunLlmConfig): ReviewAgentAdapter<BrainstormState, BrainstormArtifact> {
  return llm ? createHostedReviewAdapter("brainstorm", llm) : FAKE_STAGES.brainstorm.review()
}

export function createVisualCompanionStage(llm?: RunLlmConfig): StageAgentAdapter<VisualCompanionState, WireframeArtifact> {
  return llm ? createHostedStageAdapter("visual-companion", llm) : FAKE_STAGES["visual-companion"].stage()
}
export function createVisualCompanionReview(llm?: RunLlmConfig): ReviewAgentAdapter<VisualCompanionState, WireframeArtifact> {
  return llm ? createHostedReviewAdapter("visual-companion", llm) : FAKE_STAGES["visual-companion"].review()
}

export function createFrontendDesignStage(llm?: RunLlmConfig): StageAgentAdapter<FrontendDesignState, DesignArtifact> {
  return llm ? createHostedStageAdapter("frontend-design", llm) : FAKE_STAGES["frontend-design"].stage()
}
export function createFrontendDesignReview(llm?: RunLlmConfig): ReviewAgentAdapter<FrontendDesignState, DesignArtifact> {
  return llm ? createHostedReviewAdapter("frontend-design", llm) : FAKE_STAGES["frontend-design"].review()
}

export function createRequirementsStage(llm?: RunLlmConfig): StageAgentAdapter<RequirementsState, RequirementsArtifact> {
  return llm ? createHostedStageAdapter("requirements", llm) : FAKE_STAGES.requirements.stage()
}
export function createRequirementsReview(llm?: RunLlmConfig): ReviewAgentAdapter<RequirementsState, RequirementsArtifact> {
  return llm ? createHostedReviewAdapter("requirements", llm) : FAKE_STAGES.requirements.review()
}

export function createArchitectureStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  return llm ? createHostedStageAdapter("architecture", llm) : FAKE_STAGES.architecture.stage(project)
}
export function createArchitectureReview(llm?: RunLlmConfig): ReviewAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  return llm ? createHostedReviewAdapter("architecture", llm) : FAKE_STAGES.architecture.review()
}

export function createPlanningStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  return llm ? createHostedStageAdapter("planning", llm) : FAKE_STAGES.planning.stage(project)
}
export function createPlanningReview(llm?: RunLlmConfig): ReviewAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  return llm ? createHostedReviewAdapter("planning", llm) : FAKE_STAGES.planning.review()
}

export function createDocumentationStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<DocumentationState, DocumentationArtifact> {
  return llm ? createHostedStageAdapter("documentation", llm) : FAKE_STAGES.documentation.stage(project)
}
export function createDocumentationReview(llm?: RunLlmConfig): ReviewAgentAdapter<DocumentationState, DocumentationArtifact> {
  return llm ? createHostedReviewAdapter("documentation", llm) : FAKE_STAGES.documentation.review()
}

export function createProjectReviewStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<ProjectReviewState, ProjectReviewArtifact> {
  return llm ? createHostedStageAdapter("project-review", llm) : FAKE_STAGES["project-review"].stage(project)
}
export function createProjectReviewReview(llm?: RunLlmConfig): ReviewAgentAdapter<ProjectReviewState, ProjectReviewArtifact> {
  return llm ? createHostedReviewAdapter("project-review", llm) : FAKE_STAGES["project-review"].review()
}

export function createTestWriterStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  return llm ? createHostedStageAdapter("test-writer", llm) : FAKE_STAGES["test-writer"].stage(project)
}
export function createTestWriterReview(llm?: RunLlmConfig): ReviewAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  return llm ? createHostedReviewAdapter("test-writer", llm) : FAKE_STAGES["test-writer"].review()
}

export function createQaStage(llm?: RunLlmConfig): StageAgentAdapter<QaState, QaArtifact> {
  return llm ? createHostedStageAdapter("qa", llm) : FAKE_STAGES.qa.stage()
}
export function createQaReview(llm?: RunLlmConfig): ReviewAgentAdapter<QaState, QaArtifact> {
  return llm ? createHostedReviewAdapter("qa", llm) : FAKE_STAGES.qa.review()
}

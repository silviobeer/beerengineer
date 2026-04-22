import type { ProviderId } from "./types.js"
import type { ReviewAgentAdapter, StageAgentAdapter } from "../core/adapters.js"
import { emitEvent, getActiveRun } from "../core/runContext.js"
import type { HarnessProfile, HarnessRole, WorkspaceRuntimePolicy } from "../types/workspace.js"

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
import { FakeTestWriterReviewAdapter } from "./fake/testWriterReview.js"
import { FakeTestWriterStageAdapter } from "./fake/testWriterStage.js"

import type { ArchitectureArtifact, ArchitectureState } from "../stages/architecture/types.js"
import type { BrainstormArtifact, BrainstormState } from "../stages/brainstorm/types.js"
import type { DocumentationArtifact, DocumentationState } from "../stages/documentation/types.js"
import type { StoryTestPlanArtifact, TestWriterState } from "../stages/execution/types.js"
import type { ImplementationPlanArtifact, PlanningState } from "../stages/planning/types.js"
import type { ProjectReviewArtifact, ProjectReviewState } from "../stages/project-review/types.js"
import type { QaArtifact, QaState } from "../stages/qa/types.js"
import type { RequirementsArtifact, RequirementsState } from "../stages/requirements/types.js"
import type { Project } from "../types/domain.js"
import { HostedReviewAdapter, HostedStageAdapter } from "./hosted/hostedCliAdapter.js"
import { buildClaudeCommand } from "./hosted/providers/claude.js"
import { buildCodexCommand } from "./hosted/providers/codex.js"
import { buildOpenCodeCommand } from "./hosted/providers/opencode.js"

export type RuntimePolicy =
  | { mode: "safe-readonly" }
  | { mode: "safe-workspace-write" }
  | { mode: "unsafe-autonomous-write" }

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
  | "requirements"
  | "architecture"
  | "planning"
  | "documentation"
  | "project-review"
  | "test-writer"
  | "qa"
  | "execution"

type AdapterFactoryInput = {
  workspaceRoot: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  role: HarnessRole
  stage: StageId
  testingOverride?: "fake"
}

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

export function resolveHarness(input: AdapterFactoryInput): ResolvedHarness {
  if (input.testingOverride === "fake" || process.env.BEERENGINEER_FORCE_FAKE_LLM === "1") {
    return { harness: "fake", provider: "fake", workspaceRoot: input.workspaceRoot }
  }
  const role = input.role
  switch (input.harnessProfile.mode) {
    case "claude-only":
    case "claude-first":
      return { harness: "claude-code", provider: "claude-code", workspaceRoot: input.workspaceRoot }
    case "codex-only":
    case "codex-first":
      return { harness: "codex", provider: "codex", workspaceRoot: input.workspaceRoot }
    case "fast":
      return {
        harness: "claude-code",
        provider: "claude-code",
        model: "claude-haiku-4-5",
        workspaceRoot: input.workspaceRoot,
      }
    case "opencode":
    case "opencode-china":
    case "opencode-euro":
      throw new Error(`Harness profile mode "${input.harnessProfile.mode}" is not implemented yet`)
    case "self": {
      const selected = input.harnessProfile.roles[role]
      const provider = toProviderId(selected.harness)
      if (provider === "opencode") {
        throw new Error('Harness profile resolves to "opencode", which is not implemented yet')
      }
      return {
        harness: provider,
        provider,
        model: selected.model,
        workspaceRoot: input.workspaceRoot,
      }
    }
  }
}

function stageAuthoringPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.stageAuthoring }
}

function reviewerPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.reviewer }
}

function buildCommand(provider: RealProviderId, input: {
  model?: string
  workspaceRoot: string
  policy: RuntimePolicy
  responsePath: string
}): string[] {
  switch (provider) {
    case "claude-code":
      return buildClaudeCommand({
        model: input.model,
        workspaceRoot: input.workspaceRoot,
        policy: input.policy,
      })
    case "codex":
      return buildCodexCommand(input)
    case "opencode":
      return buildOpenCodeCommand()
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
  const harness = resolveHarness({
    workspaceRoot: llm.workspaceRoot,
    harnessProfile: llm.harnessProfile,
    runtimePolicy: llm.runtimePolicy,
    role: "coder",
    stage,
    testingOverride: llm.testingOverride,
  })
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
    buildCommand: input => buildCommand(provider, input),
  })
}

function createHostedReviewAdapter<S, A>(stage: StageId, llm: RunLlmConfig): ReviewAgentAdapter<S, A> {
  const harness = resolveHarness({
    workspaceRoot: llm.workspaceRoot,
    harnessProfile: llm.harnessProfile,
    runtimePolicy: llm.runtimePolicy,
    role: "reviewer",
    stage,
    testingOverride: llm.testingOverride,
  })
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
    buildCommand: input => buildCommand(provider, input),
  })
}

export function executionCoderPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.coderExecution }
}

export function createBrainstormStage(project: Project | undefined, llm?: RunLlmConfig): StageAgentAdapter<BrainstormState, BrainstormArtifact> {
  return llm ? createHostedStageAdapter("brainstorm", llm) : new FakeBrainstormStageAdapter()
}

export function createBrainstormReview(llm?: RunLlmConfig): ReviewAgentAdapter<BrainstormState, BrainstormArtifact> {
  return llm ? createHostedReviewAdapter("brainstorm", llm) : new FakeBrainstormReviewAdapter()
}

export function createRequirementsStage(llm?: RunLlmConfig): StageAgentAdapter<RequirementsState, RequirementsArtifact> {
  return llm ? createHostedStageAdapter("requirements", llm) : new FakeRequirementsStageAdapter()
}

export function createRequirementsReview(llm?: RunLlmConfig): ReviewAgentAdapter<RequirementsState, RequirementsArtifact> {
  return llm ? createHostedReviewAdapter("requirements", llm) : new FakeRequirementsReviewAdapter()
}

export function createArchitectureStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  return llm ? createHostedStageAdapter("architecture", llm) : new FakeArchitectureStageAdapter(project)
}

export function createArchitectureReview(llm?: RunLlmConfig): ReviewAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  return llm ? createHostedReviewAdapter("architecture", llm) : new FakeArchitectureReviewAdapter()
}

export function createPlanningStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  return llm ? createHostedStageAdapter("planning", llm) : new FakePlanningStageAdapter(project)
}

export function createPlanningReview(llm?: RunLlmConfig): ReviewAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  return llm ? createHostedReviewAdapter("planning", llm) : new FakePlanningReviewAdapter()
}

export function createDocumentationStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<DocumentationState, DocumentationArtifact> {
  return llm ? createHostedStageAdapter("documentation", llm) : new FakeDocumentationStageAdapter(project)
}

export function createDocumentationReview(llm?: RunLlmConfig): ReviewAgentAdapter<DocumentationState, DocumentationArtifact> {
  return llm ? createHostedReviewAdapter("documentation", llm) : new FakeDocumentationReviewAdapter()
}

export function createProjectReviewStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<ProjectReviewState, ProjectReviewArtifact> {
  return llm ? createHostedStageAdapter("project-review", llm) : new FakeProjectReviewStageAdapter(project)
}

export function createProjectReviewReview(llm?: RunLlmConfig): ReviewAgentAdapter<ProjectReviewState, ProjectReviewArtifact> {
  return llm ? createHostedReviewAdapter("project-review", llm) : new FakeProjectReviewReviewAdapter()
}

export function createTestWriterStage(project: Project, llm?: RunLlmConfig): StageAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  return llm ? createHostedStageAdapter("test-writer", llm) : new FakeTestWriterStageAdapter(project)
}

export function createTestWriterReview(llm?: RunLlmConfig): ReviewAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  return llm ? createHostedReviewAdapter("test-writer", llm) : new FakeTestWriterReviewAdapter()
}

export function createQaStage(llm?: RunLlmConfig): StageAgentAdapter<QaState, QaArtifact> {
  return llm ? createHostedStageAdapter("qa", llm) : new FakeQaStageAdapter()
}

export function createQaReview(llm?: RunLlmConfig): ReviewAgentAdapter<QaState, QaArtifact> {
  return llm ? createHostedReviewAdapter("qa", llm) : new FakeQaReviewAdapter()
}

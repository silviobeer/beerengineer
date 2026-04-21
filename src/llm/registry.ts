import type { ProviderId } from "./types.js"
import type { ReviewAgentAdapter, StageAgentAdapter } from "../core/adapters.js"

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

export type StageLlmConfig = {
  stageAgent: { provider: ProviderId }
  reviewer: { provider: ProviderId }
}

export const defaultStageConfig: StageLlmConfig = {
  stageAgent: { provider: "fake" },
  reviewer: { provider: "fake" },
}

function selectProvider<T>(provider: ProviderId, options: { fake: () => T }): T {
  switch (provider) {
    case "fake":
      return options.fake()
    case "codex":
    case "claude-code":
      throw new Error(`Provider "${provider}" ist noch nicht implementiert`)
  }
}

export const createBrainstormStage = (p: ProviderId): StageAgentAdapter<BrainstormState, BrainstormArtifact> =>
  selectProvider(p, { fake: () => new FakeBrainstormStageAdapter() })

export const createBrainstormReview = (p: ProviderId): ReviewAgentAdapter<BrainstormState, BrainstormArtifact> =>
  selectProvider(p, { fake: () => new FakeBrainstormReviewAdapter() })

export const createRequirementsStage = (p: ProviderId): StageAgentAdapter<RequirementsState, RequirementsArtifact> =>
  selectProvider(p, { fake: () => new FakeRequirementsStageAdapter() })

export const createRequirementsReview = (p: ProviderId): ReviewAgentAdapter<RequirementsState, RequirementsArtifact> =>
  selectProvider(p, { fake: () => new FakeRequirementsReviewAdapter() })

export const createArchitectureStage = (p: ProviderId, project: Project): StageAgentAdapter<ArchitectureState, ArchitectureArtifact> =>
  selectProvider(p, { fake: () => new FakeArchitectureStageAdapter(project) })

export const createArchitectureReview = (p: ProviderId): ReviewAgentAdapter<ArchitectureState, ArchitectureArtifact> =>
  selectProvider(p, { fake: () => new FakeArchitectureReviewAdapter() })

export const createPlanningStage = (p: ProviderId, project: Project): StageAgentAdapter<PlanningState, ImplementationPlanArtifact> =>
  selectProvider(p, { fake: () => new FakePlanningStageAdapter(project) })

export const createPlanningReview = (p: ProviderId): ReviewAgentAdapter<PlanningState, ImplementationPlanArtifact> =>
  selectProvider(p, { fake: () => new FakePlanningReviewAdapter() })

export const createDocumentationStage = (p: ProviderId, project: Project): StageAgentAdapter<DocumentationState, DocumentationArtifact> =>
  selectProvider(p, { fake: () => new FakeDocumentationStageAdapter(project) })

export const createDocumentationReview = (p: ProviderId): ReviewAgentAdapter<DocumentationState, DocumentationArtifact> =>
  selectProvider(p, { fake: () => new FakeDocumentationReviewAdapter() })

export const createProjectReviewStage = (p: ProviderId, project: Project): StageAgentAdapter<ProjectReviewState, ProjectReviewArtifact> =>
  selectProvider(p, { fake: () => new FakeProjectReviewStageAdapter(project) })

export const createProjectReviewReview = (p: ProviderId): ReviewAgentAdapter<ProjectReviewState, ProjectReviewArtifact> =>
  selectProvider(p, { fake: () => new FakeProjectReviewReviewAdapter() })

export const createTestWriterStage = (p: ProviderId, project: Project): StageAgentAdapter<TestWriterState, StoryTestPlanArtifact> =>
  selectProvider(p, { fake: () => new FakeTestWriterStageAdapter(project) })

export const createTestWriterReview = (p: ProviderId): ReviewAgentAdapter<TestWriterState, StoryTestPlanArtifact> =>
  selectProvider(p, { fake: () => new FakeTestWriterReviewAdapter() })

export const createQaStage = (p: ProviderId): StageAgentAdapter<QaState, QaArtifact> =>
  selectProvider(p, { fake: () => new FakeQaStageAdapter() })

export const createQaReview = (p: ProviderId): ReviewAgentAdapter<QaState, QaArtifact> =>
  selectProvider(p, { fake: () => new FakeQaReviewAdapter() })

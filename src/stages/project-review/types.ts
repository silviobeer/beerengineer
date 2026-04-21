import type {
  ArchitectureArtifact,
  ImplementationPlanArtifact,
  PRD,
  ProjectReviewArtifact,
  ProjectReviewFinding,
  WaveSummary,
} from "../../types.js"

export type ProjectReviewState = {
  projectId: string
  prd: PRD
  architecture: ArchitectureArtifact
  implementationPlan: ImplementationPlanArtifact
  executionSummaries: WaveSummary[]
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ProjectReviewArtifact, ProjectReviewFinding }

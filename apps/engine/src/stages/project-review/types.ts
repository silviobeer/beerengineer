import type {
  ArchitectureArtifact,
  ImplementationPlanArtifact,
  PRD,
  ProjectReviewArtifact,
  ProjectReviewFinding,
  WaveSummary,
} from "../../types.js"

export type ProjectReviewRepoEvidence = {
  branch: string
  trackedFileCount: number
  trackedFilesSample: string[]
  checkedFiles: Array<{
    path: string
    exists: boolean
    excerpt?: string
  }>
}

export type ProjectReviewState = {
  projectId: string
  prd: PRD
  architecture: ArchitectureArtifact
  implementationPlan: ImplementationPlanArtifact
  executionSummaries: WaveSummary[]
  repoEvidence?: ProjectReviewRepoEvidence
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ProjectReviewArtifact, ProjectReviewFinding }

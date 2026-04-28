import type {
  ArchitectureArtifact,
  PlanSummary,
  PRD,
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
  planSummary: PlanSummary
  executionSummaries: WaveSummary[]
  repoEvidence?: ProjectReviewRepoEvidence
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ProjectReviewArtifact, ProjectReviewFinding } from "../../types.js"

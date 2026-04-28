import type {
  ArchitectureSummary,
  PlanSummary,
  PrdDigest,
  ProjectReviewArtifact,
  WaveSummary,
} from "../../types.js"

export type DocumentationState = {
  projectId: string
  prdDigest: PrdDigest
  architectureSummary: ArchitectureSummary
  planSummary: PlanSummary
  executionSummaries: WaveSummary[]
  projectReview: ProjectReviewArtifact
  revisionCount: number
  lastReviewFeedback?: string
  existingDocs: {
    technicalDoc?: string
    featuresDoc?: string
    compactReadme?: string
  }
}

export type { DocumentationArtifact, DocumentationSection } from "../../types.js"

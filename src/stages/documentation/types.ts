import type {
  ArchitectureArtifact,
  DocumentationArtifact,
  DocumentationSection,
  ImplementationPlanArtifact,
  PRD,
  ProjectReviewArtifact,
  WaveSummary,
} from "../../types.js"

export type DocumentationState = {
  projectId: string
  prd: PRD
  architecture: ArchitectureArtifact
  implementationPlan: ImplementationPlanArtifact
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

export type { DocumentationArtifact, DocumentationSection }

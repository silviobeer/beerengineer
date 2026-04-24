import type { ArchitectureArtifact, DesignArtifact, PRD, WireframeArtifact } from "../../types.js"

export type ArchitectureState = {
  projectId: string
  prd: PRD
  wireframes?: WireframeArtifact
  design?: DesignArtifact
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ArchitectureArtifact }

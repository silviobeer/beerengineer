import type { ArchitectureArtifact, PRD } from "../../types.js"

export type ArchitectureState = {
  projectId: string
  prd: PRD
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ArchitectureArtifact }

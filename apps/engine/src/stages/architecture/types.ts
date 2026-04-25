import type { ArchitectureArtifact, DesignArtifact, PRD, WireframeArtifact } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"

export type ArchitectureState = {
  projectId: string
  prd: PRD
  wireframes?: WireframeArtifact
  design?: DesignArtifact
  codebase?: CodebaseSnapshot
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ArchitectureArtifact }

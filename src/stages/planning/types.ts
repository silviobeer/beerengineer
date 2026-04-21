import type { ArchitectureArtifact, ImplementationPlanArtifact, PRD } from "../../types.js"

export type PlanningState = {
  projectId: string
  prd: PRD
  architectureArtifact: ArchitectureArtifact
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ImplementationPlanArtifact }

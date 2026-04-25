import type { ItemDecision } from "../../core/itemDecisions.js"
import type { ArchitectureArtifact, ImplementationPlanArtifact, PRD } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"

export type PlanningState = {
  projectId: string
  prd: PRD
  architectureArtifact: ArchitectureArtifact
  codebase?: CodebaseSnapshot
  decisions?: ItemDecision[]
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ImplementationPlanArtifact }

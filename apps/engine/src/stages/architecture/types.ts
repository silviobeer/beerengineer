import type { ImportContextArtifact } from "../../core/importContext.js"
import type { ItemDecision } from "../../core/itemDecisions.js"
import type { PRD, WireframeArtifact } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"

export type ArchitectureState = {
  projectId: string
  prd: PRD
  importContext?: ImportContextArtifact
  wireframes?: WireframeArtifact
  design?: {
    tone: string
    antiPatterns: string[]
  }
  codebase?: CodebaseSnapshot
  decisions?: ItemDecision[]
  revisionCount: number
  lastReviewFeedback?: string
}

export type { ArchitectureArtifact } from "../../types.js"

import type { ItemDecision } from "../../core/itemDecisions.js"
import type { ChatMessage } from "../../llm/types.js"
import type { Concept, PRD, WireframeArtifact } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"

export type RequirementsArtifact = {
  concept: Concept
  prd: PRD
}

export type RequirementsState = {
  concept: Concept
  wireframes?: WireframeArtifact
  design?: {
    tone: string
    antiPatterns: string[]
  }
  codebase?: CodebaseSnapshot
  decisions?: ItemDecision[]
  clarificationCount: number
  maxClarifications: number
  history: ChatMessage[]
  lastReviewFeedback?: string
}

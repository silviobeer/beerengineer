import type { ChatMessage } from "../../llm/types.js"
import type { Concept, DesignArtifact, PRD, WireframeArtifact } from "../../types.js"

export type RequirementsArtifact = {
  concept: Concept
  prd: PRD
}

export type RequirementsState = {
  concept: Concept
  wireframes?: WireframeArtifact
  design?: DesignArtifact
  clarificationCount: number
  maxClarifications: number
  history: ChatMessage[]
  lastReviewFeedback?: string
}

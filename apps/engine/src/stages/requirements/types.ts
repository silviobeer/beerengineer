import type { ChatMessage } from "../../llm/types.js"
import type { Concept, PRD } from "../../types.js"

export type RequirementsArtifact = {
  concept: Concept
  prd: PRD
}

export type RequirementsState = {
  concept: Concept
  clarificationCount: number
  maxClarifications: number
  history: ChatMessage[]
  lastReviewFeedback?: string
}

import type { ChatMessage } from "../../llm/types.js"
import type { Concept, Item, Project } from "../../types.js"

export type BrainstormArtifact = {
  concept: Concept & { hasUi: boolean }
  projects: Project[]
}

export type BrainstormState = {
  item: Item
  questionsAsked: number
  targetQuestions: number
  history: ChatMessage[]
}

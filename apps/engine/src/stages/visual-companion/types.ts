import type { ChatMessage } from "../../llm/types.js"
import type { Concept, Project, ReferenceInput, WireframeArtifact } from "../../types/domain.js"

export type DesignPrepInput = {
  itemConcept: Concept & { hasUi?: boolean }
  projects: Array<Project & { hasUi?: boolean }>
  references?: ReferenceInput[]
}

export type VisualCompanionState = {
  input: DesignPrepInput
  inputMode: "none" | "references"
  references: ReferenceInput[]
  history: ChatMessage[]
  clarificationCount: number
  maxClarifications: number
}

export type { WireframeArtifact }

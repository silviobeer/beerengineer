import type { ChatMessage } from "../../llm/types.js"
import type { Concept, Project, ReferenceInput, WireframeArtifact } from "../../types/domain.js"
import type { CodebaseSnapshot } from "../../types/context.js"

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
  /** Feedback from the user's post-artifact review ("revise: …"). Injected at
   *  the start of a new runStage iteration so the stage agent can read it. */
  pendingRevisionFeedback?: string
  /** How many user review rounds have completed (approve/revise). */
  userReviewRound: number
  /** Brownfield context snapshot — top-level files + tree summary for the
   *  workspace. Optional because greenfield items have nothing to surface. */
  codebase?: CodebaseSnapshot
}

export type { WireframeArtifact }

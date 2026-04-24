import type { ChatMessage } from "../../llm/types.js"
import type { DesignArtifact, ReferenceInput, WireframeArtifact } from "../../types/domain.js"
import type { DesignPrepInput } from "../visual-companion/types.js"

export type FrontendDesignInput = DesignPrepInput & {
  wireframes?: WireframeArtifact
  references?: ReferenceInput[]
}

export type FrontendDesignState = {
  input: FrontendDesignInput
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
}

export type { DesignArtifact }

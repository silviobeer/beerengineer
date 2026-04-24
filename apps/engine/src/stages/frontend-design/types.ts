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
}

export type { DesignArtifact }

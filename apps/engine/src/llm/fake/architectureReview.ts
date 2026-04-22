import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { ArchitectureArtifact, ArchitectureState } from "../../stages/architecture/types.js"

export class FakeArchitectureReviewAdapter
  implements ReviewAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  private attempts = 0

  async review(): Promise<ReviewAgentResponse> {
    this.attempts++
    if (this.attempts >= 2) return { kind: "pass" }
    return {
      kind: "revise",
      feedback: "Please sharpen system boundaries, core components, and risks for this project.",
    }
  }
}

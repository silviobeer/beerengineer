import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { RequirementsArtifact, RequirementsState } from "../../stages/requirements/types.js"

export class FakeRequirementsReviewAdapter
  implements ReviewAgentAdapter<RequirementsState, RequirementsArtifact> {
  private attempts = 0

  async review(): Promise<ReviewAgentResponse> {
    this.attempts++
    if (this.attempts >= 2) return { kind: "pass" }
    return {
      kind: "revise",
      feedback: "Story US-02 is still too vague. Please refine scope and acceptance criteria based on the concept.",
    }
  }
}

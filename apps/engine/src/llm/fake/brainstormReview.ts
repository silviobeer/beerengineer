import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { BrainstormArtifact, BrainstormState } from "../../stages/brainstorm/types.js"

export class FakeBrainstormReviewAdapter implements ReviewAgentAdapter<BrainstormState, BrainstormArtifact> {
  private attempts = 0

  async review(): Promise<ReviewAgentResponse> {
    this.attempts++
    if (this.attempts >= 2) return { kind: "pass" }
    return {
      kind: "revise",
      feedback: "Please sharpen the problem, target audience, or constraints a bit more.",
    }
  }
}

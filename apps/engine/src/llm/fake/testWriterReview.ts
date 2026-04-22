import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { StoryTestPlanArtifact, TestWriterState } from "../../stages/execution/types.js"

export class FakeTestWriterReviewAdapter
  implements ReviewAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  private attempts = 0

  async review(): Promise<ReviewAgentResponse> {
    this.attempts++
    if (this.attempts >= 2) return { kind: "pass" }
    return {
      kind: "revise",
      feedback: "Please sharpen the test case -> AC mapping and add relevant edge cases.",
    }
  }
}

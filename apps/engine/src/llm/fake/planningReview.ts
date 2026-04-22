import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { ImplementationPlanArtifact, PlanningState } from "../../stages/planning/types.js"

export class FakePlanningReviewAdapter
  implements ReviewAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  private attempts = 0

  async review(): Promise<ReviewAgentResponse> {
    this.attempts++
    if (this.attempts >= 2) return { kind: "pass" }
    return {
      kind: "revise",
      feedback: "Please sharpen wave goals, dependencies, and exit criteria for the implementation plan.",
    }
  }
}

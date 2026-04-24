import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { DesignArtifact } from "../../types/domain.js"
import type { FrontendDesignState } from "../../stages/frontend-design/types.js"

export class FakeFrontendDesignReviewAdapter implements ReviewAgentAdapter<FrontendDesignState, DesignArtifact> {
  async review(input?: { artifact: DesignArtifact }): Promise<ReviewAgentResponse> {
    const artifact = input?.artifact
    if (!artifact?.tokens.light.primary || !artifact?.typography.display.family) {
      return { kind: "revise", feedback: "Fill all core token categories before approval." }
    }
    return { kind: "pass" }
  }
}

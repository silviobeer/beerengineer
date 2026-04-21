import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { QaArtifact, QaState } from "../../stages/qa/types.js"

export class FakeQaReviewAdapter implements ReviewAgentAdapter<QaState, QaArtifact> {
  async review(input: { artifact: QaArtifact; state: QaState }): Promise<ReviewAgentResponse> {
    if (input.artifact.accepted || input.artifact.findings.length === 0) {
      return { kind: "pass" }
    }
    return {
      kind: "revise",
      feedback: input.artifact.findings
        .map(f => `[${f.source}/${f.severity}] ${f.message}`)
        .join("; "),
    }
  }
}

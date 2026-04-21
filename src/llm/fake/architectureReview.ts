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
      feedback: "Bitte schaerfe Systemgrenzen, Kernkomponenten und Risiken fuer dieses Projekt.",
    }
  }
}

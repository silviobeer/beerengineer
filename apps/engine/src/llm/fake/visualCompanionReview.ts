import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { WireframeArtifact } from "../../types/domain.js"
import type { VisualCompanionState } from "../../stages/visual-companion/types.js"

export class FakeVisualCompanionReviewAdapter implements ReviewAgentAdapter<VisualCompanionState, WireframeArtifact> {
  async review(input?: { artifact: WireframeArtifact; state: VisualCompanionState }): Promise<ReviewAgentResponse> {
    const artifact = input?.artifact
    const uiProjects = input?.state.input.projects.filter(project => project.hasUi) ?? []
    if (!artifact || artifact.screens.length < uiProjects.length) {
      return { kind: "revise", feedback: "Every UI-bearing project needs at least one screen." }
    }
    return { kind: "pass" }
  }
}

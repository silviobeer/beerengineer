import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { ProjectReviewState } from "../../stages/project-review/types.js"
import type { ProjectReviewArtifact } from "../../types/domain.js"

export class FakeProjectReviewReviewAdapter
  implements ReviewAgentAdapter<ProjectReviewState, ProjectReviewArtifact> {
  async review(input: { artifact: ProjectReviewArtifact; state: ProjectReviewState }): Promise<ReviewAgentResponse> {
    const highOrCriticalCount = input.artifact.findings.filter(
      finding => finding.severity === "critical" || finding.severity === "high",
    ).length
    const mediumCount = input.artifact.findings.filter(finding => finding.severity === "medium").length

    if (highOrCriticalCount > 0 || mediumCount >= 2) {
      return {
        kind: "revise",
        feedback: "Address the project-wide technical coherence issues, then resubmit with only residual low-risk cleanup items if any remain.",
      }
    }

    return { kind: "pass" }
  }
}

import type { Finding } from "../../types/review.js"
import type { PrdDigest, ProjectReviewArtifact } from "../../types.js"

export type QaState = {
  projectId: string
  projectBranch: string
  prdDigest: PrdDigest
  projectReview: ProjectReviewArtifact
  loop: number
  findings: Finding[]
}

export type QaVerdict = {
  /**
   * Story, acceptance criterion, or requirement identifier. Examples:
   * `PROJ-8-PRD-3-US-5`, `AC-17`, or `REQ-2`.
   */
  requirement: string
  status: "passed" | "failed" | "unverified" | "not_applicable"
  evidence: string
}

export type QaArtifact = {
  accepted: boolean
  loops: number
  verdicts: QaVerdict[]
  findings: Finding[]
}

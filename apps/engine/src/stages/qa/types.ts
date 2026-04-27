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

export type QaArtifact = {
  accepted: boolean
  loops: number
  findings: Finding[]
}

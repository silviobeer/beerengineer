import type { Finding } from "../../types/review.js"

export type QaState = {
  loop: number
  findings: Finding[]
}

export type QaArtifact = {
  accepted: boolean
  loops: number
  findings: Finding[]
}

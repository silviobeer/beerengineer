import type { AcceptanceCriterion, StoryTestPlanArtifact, WaveDefinition } from "../../types.js"

export type TestWriterState = {
  projectId: string
  wave: WaveDefinition
  story: {
    id: string
    title: string
  }
  acceptanceCriteria: AcceptanceCriterion[]
  design?: {
    antiPatterns: string[]
  }
  architectureSummary?: {
    summary: string
    systemShape: string
    constraints: string[]
    relevantComponents: Array<{
      name: string
      responsibility: string
    }>
    decisions: Array<{
      id: string
      summary: string
      rationale?: string
    }>
  }
  revisionCount: number
  lastReviewFeedback?: string
}

export type { StoryTestPlanArtifact }

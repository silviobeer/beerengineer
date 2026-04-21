import type { AcceptanceCriterion, StoryTestPlanArtifact, WaveDefinition } from "../../types.js"

export type TestWriterState = {
  projectId: string
  wave: WaveDefinition
  story: {
    id: string
    title: string
  }
  acceptanceCriteria: AcceptanceCriterion[]
  revisionCount: number
  lastReviewFeedback?: string
}

export type { StoryTestPlanArtifact }

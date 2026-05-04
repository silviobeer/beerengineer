import type { WaveDefinition } from "../../types.js"

export type StoryDbRelevanceStatus = {
  storyId: string
  value: boolean
  source: "explicit" | "override" | "detector"
  reason?: string
}

export function buildDbRelevanceWaveStatus(wave: WaveDefinition): {
  dbRelevantWave: boolean
  willInvokeSupabase: boolean
  stories: StoryDbRelevanceStatus[]
} {
  const stories = wave.stories.map(story => {
    if (story.dbRelevanceOverride === "not-db-relevant") {
      return {
        storyId: story.id,
        value: false,
        source: "override" as const,
        reason: story.dbRelevanceOverrideReason,
      }
    }
    return { storyId: story.id, value: story.dbRelevant === true, source: "explicit" as const }
  })
  const dbRelevantWave = stories.some(story => story.value)
  return { dbRelevantWave, willInvokeSupabase: dbRelevantWave, stories }
}

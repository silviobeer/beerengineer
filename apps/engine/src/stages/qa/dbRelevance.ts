import { evaluateDbRelevanceMismatch } from "../../core/dbRelevance/mismatch.js"
import type { DbRelevanceSignal, DbRelevanceStory } from "../../core/dbRelevance/types.js"

export function qaDbRelevanceMismatch(story: DbRelevanceStory, signals: DbRelevanceSignal[]) {
  return evaluateDbRelevanceMismatch(story, signals)
}

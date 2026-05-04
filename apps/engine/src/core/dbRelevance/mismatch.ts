import type { DbRelevanceSignal, DbRelevanceStory } from "./types.js"

export type DbRelevanceMismatchResult =
  | { blocked: false; reason?: string }
  | { blocked: true; status: "blocked"; signals: DbRelevanceSignal[]; message: string }

export function evaluateDbRelevanceMismatch(story: DbRelevanceStory, signals: DbRelevanceSignal[]): DbRelevanceMismatchResult {
  if (story.dbRelevant) return { blocked: false, reason: "explicit-db-relevant" }
  if (story.dbRelevanceOverride === "not-db-relevant") return { blocked: false, reason: story.dbRelevanceOverrideReason }
  if (signals.length === 0) return { blocked: false, reason: "no-signals" }
  return {
    blocked: true,
    status: "blocked",
    signals,
    message: `DB relevance mismatch for ${story.id}: ${signals.map(signal => `${signal.path} (${signal.reason})`).join(", ")}`,
  }
}

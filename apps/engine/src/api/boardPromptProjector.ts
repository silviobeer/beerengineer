import type { BoardProjector } from "./boardProjectionTypes.js"

function reviewGateWaiting(actionsJson: string | null | undefined): boolean {
  if (!actionsJson) return false
  try {
    const parsed = JSON.parse(actionsJson) as unknown
    if (!Array.isArray(parsed)) return false
    return parsed.some(item => typeof item === "object" && item !== null && "value" in item && item.value === "promote")
  } catch {
    return false
  }
}

export const projectBoardPrompts: BoardProjector = ({ openPrompt }) => ({
  hasOpenPrompt: Boolean(openPrompt),
  hasReviewGateWaiting: reviewGateWaiting(openPrompt?.actions_json),
})

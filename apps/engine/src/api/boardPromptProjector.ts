import type { BoardProjector } from "./boardProjectionTypes.js"

function reviewGateWaiting(actionsJson: string | null | undefined): boolean {
  if (!actionsJson) return false
  try {
    const actions = JSON.parse(actionsJson) as Array<{ value?: unknown }>
    return actions.some(action => action?.value === "promote")
  } catch {
    return false
  }
}

export const projectBoardPrompts: BoardProjector = ({ openPrompt }) => ({
  hasOpenPrompt: Boolean(openPrompt),
  hasReviewGateWaiting: reviewGateWaiting(openPrompt?.actions_json),
})

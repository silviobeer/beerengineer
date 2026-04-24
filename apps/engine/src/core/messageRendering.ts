import type { MessageEntry } from "./messagingProjection.js"
import { presentMessageEntry } from "./messagePresentation.js"

export function renderMessageEntry(entry: MessageEntry): string {
  const presentation = presentMessageEntry(entry)
  return presentation.detail
    ? `${presentation.icon} ${presentation.label}  ${presentation.detail}`
    : `${presentation.icon} ${presentation.label}`
}

export function terminalExitCodeForEntry(entry: MessageEntry): number | null {
  switch (entry.type) {
    case "run_blocked":
      return 11
    case "run_failed":
    case "phase_failed":
      return 10
    case "run_finished":
      return entry.payload.status === "failed" ? 10 : 0
    default:
      return null
  }
}

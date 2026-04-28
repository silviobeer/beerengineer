import type { EventBus } from "../bus.js"
import type { PresentationKind, WorkflowEvent } from "../io.js"
import { presentMessageEntry } from "../messagePresentation.js"
import { messagingLevelFromQuery, shouldDeliverAtLevel, type MessagingLevel } from "../messagingLevel.js"
import { projectWorkflowEvent } from "../messagingProjection.js"

const SEVERITY_ICON: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "⚪",
}

function presentationLine(kind: PresentationKind, text: string, meta?: { source?: string; severity?: string }): string {
  switch (kind) {
    case "header": {
      const bar = "─".repeat(60)
      return `\n${bar}\n  ▶  ${text.toUpperCase()}\n${bar}`
    }
    case "step": return `  ·  ${text}`
    case "ok":   return `  ✓  ${text}`
    case "warn": return `  ⚠  ${text}`
    case "dim":  return `     ${text}`
    case "finding": {
      const icon = meta?.severity ? SEVERITY_ICON[meta.severity] ?? "·" : "·"
      const source = meta?.source ?? "?"
      const severity = meta?.severity ?? "?"
      return `     ${icon} [${source}] ${severity}: ${text}`
    }
    default:
      return text
  }
}

function chatLine(event: Extract<WorkflowEvent, { type: "chat_message" }>): string {
  return `\n  [${event.role}]\n     ${event.text}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function narrativeLine(event: WorkflowEvent): string | null {
  // `presentation`, `chat_message`, `log` are handled explicitly above; here
  // we only render canonical lifecycle events.
  if (event.type === "presentation" || event.type === "chat_message" || event.type === "log") return null
  const entry = projectWorkflowEvent(event, { id: "live" })
  const presentation = presentMessageEntry(entry)
  const detail = presentation.detail ? `  ${truncate(presentation.detail, 240)}` : ""
  return `  ${presentation.icon}  ${presentation.label}${detail}`
}

function readDefaultLevel(): MessagingLevel {
  return messagingLevelFromQuery(process.env.BEERENGINEER_CLI_LEVEL ?? null, 1)
}

/**
 * Subscribe a human-readable terminal renderer to the bus.
 *
 * Renders canonical lifecycle events (stage entered, review loop N, review
 * feedback handed back, …) as one-line sentences. Verbosity is gated by the
 * messaging-level classifier; default L1 shows operational progress
 * including loop iterations and review feedback. Set
 * BEERENGINEER_CLI_LEVEL=L0 for full debug, L2 for milestones only.
 *
 * Returns the unsubscribe function.
 */
export function attachHumanCliRenderer(
  bus: EventBus,
  opts: { stream?: NodeJS.WritableStream; level?: MessagingLevel } = {},
): () => void {
  const out = opts.stream ?? process.stdout
  const subscribedLevel = opts.level ?? readDefaultLevel()
  const write = (line: string) => { out.write(`${line}\n`) }

  return bus.subscribe(event => {
    switch (event.type) {
      case "presentation":
        write(presentationLine(event.kind, event.text, event.meta))
        return
      case "chat_message":
        write(chatLine(event))
        return
      case "log":
        if (subscribedLevel === 0 || event.level === "warn" || event.level === "error") {
          write(`  ${event.message}`)
        }
        return
      default: {
        const entry = projectWorkflowEvent(event, { id: "live" })
        if (!shouldDeliverAtLevel(entry, subscribedLevel)) return
        const line = narrativeLine(event)
        if (line) write(line)
      }
    }
  })
}

import type { EventBus } from "../bus.js"
import type { PresentationKind, WorkflowEvent } from "../io.js"

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

/**
 * Subscribe a human-readable terminal renderer to the bus.
 *
 * This is the only terminal writer in the codebase. It picks a subset of
 * events worth showing the operator; everything else stays silent.
 * Returns the unsubscribe function.
 */
export function attachHumanCliRenderer(
  bus: EventBus,
  opts: { stream?: NodeJS.WritableStream } = {},
): () => void {
  const out = opts.stream ?? process.stdout
  const write = (line: string) => { out.write(`${line}\n`) }

  return bus.subscribe(event => {
    switch (event.type) {
      case "presentation":
        write(presentationLine(event.kind, event.text, event.meta))
        break
      case "chat_message":
        write(chatLine(event))
        break
      case "log":
        write(`  ${event.message}`)
        break
      default:
        break
    }
  })
}

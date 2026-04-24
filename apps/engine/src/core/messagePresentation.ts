import type { MessageEntry } from "./messagingProjection.js"

function payloadString(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

export type MessagePresentation = {
  icon: string
  label: string
  detail?: string
}

export function presentMessageEntry(entry: MessageEntry): MessagePresentation {
  switch (entry.type) {
    case "run_started":
      return { icon: "🚀", label: "run started", detail: payloadString(entry.payload.title, entry.runId) }
    case "run_finished":
      return { icon: "🏁", label: "run finished", detail: payloadString(entry.payload.status, "completed") }
    case "run_failed":
      return { icon: "💥", label: "run failed", detail: payloadString(entry.payload.summary) }
    case "run_blocked":
      return { icon: "🧱", label: "run blocked", detail: payloadString(entry.payload.summary) }
    case "run_resumed":
      return { icon: "🪄", label: "run resumed" }
    case "phase_started":
      return { icon: "🧭", label: "-> phase", detail: payloadString(entry.payload.stageKey) }
    case "phase_completed":
      return { icon: "✅", label: "<- phase", detail: payloadString(entry.payload.stageKey) }
    case "phase_failed":
      return { icon: "⚠️", label: "<- phase", detail: `${payloadString(entry.payload.stageKey)} failed` }
    case "prompt_requested":
      return { icon: "❓", label: "? prompt", detail: payloadString(entry.payload.prompt) }
    case "prompt_answered":
      return { icon: "💬", label: "> answer", detail: payloadString(entry.payload.answer) }
    case "loop_iteration":
      return {
        icon: "🔁",
        label: "loop",
        detail: `${payloadString(entry.payload.phase)} #${payloadString(String(entry.payload.n ?? ""), "0")}`,
      }
    case "tool_called":
      return {
        icon: "🛠️",
        label: "tool",
        detail: [
          payloadString(entry.payload.name),
          typeof entry.payload.provider === "string" ? `(${entry.payload.provider})` : undefined,
          typeof entry.payload.argsPreview === "string" ? `args=${entry.payload.argsPreview}` : undefined,
        ].filter(Boolean).join(" "),
      }
    case "tool_result":
      return {
        icon: "📦",
        label: "tool result",
        detail: [
          payloadString(entry.payload.name),
          entry.payload.isError === true ? "(error)" : undefined,
          typeof entry.payload.resultPreview === "string" ? entry.payload.resultPreview : undefined,
        ].filter(Boolean).join(" "),
      }
    case "llm_thinking":
      return { icon: "💭", label: "thinking", detail: payloadString(entry.payload.text) }
    case "llm_tokens":
      return {
        icon: "🔢",
        label: "tokens",
        detail: [
          `in=${payloadString(String(entry.payload.in ?? 0), "0")} out=${payloadString(String(entry.payload.out ?? 0), "0")}`,
          typeof entry.payload.cached === "number" ? `cache=${entry.payload.cached}` : undefined,
          typeof entry.payload.provider === "string" ? entry.payload.provider : undefined,
          typeof entry.payload.model === "string" ? entry.payload.model : undefined,
        ].filter(Boolean).join(" "),
      }
    case "agent_message":
      return { icon: "🤖", label: "agent", detail: payloadString(entry.payload.text) }
    case "user_message":
      return { icon: "🧑", label: "user", detail: payloadString(entry.payload.text) }
    case "project_created":
      return { icon: "📚", label: "project", detail: payloadString(entry.payload.name) }
    case "log":
      return { icon: "📎", label: "log", detail: payloadString(entry.payload.message) }
    case "artifact_written":
      return { icon: "📝", label: "artifact", detail: payloadString(entry.payload.label) }
    case "external_remediation_recorded":
      return { icon: "🩹", label: "remediation", detail: payloadString(entry.payload.summary) }
    case "item_column_changed":
      return {
        icon: "📍",
        label: "item",
        detail: `${payloadString(entry.payload.column)} / ${payloadString(entry.payload.phaseStatus)}`,
      }
    case "presentation":
      return { icon: "✨", label: payloadString(entry.payload.text) }
    default:
      return {
        icon: "📣",
        label: entry.type,
        detail: payloadString(entry.payload.rawType),
      }
  }
}

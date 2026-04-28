import type { MessageEntry } from "./messagingProjection.js"

function payloadString(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

function payloadNumberString(value: unknown, fallback: string): string {
  return typeof value === "number" ? String(value) : fallback
}

function branchTransitionDetail(entry: MessageEntry): string {
  return `${payloadString(entry.payload.itemBranch)} → ${payloadString(entry.payload.baseBranch)}`
}

function iterationLabel(n: string, phase: unknown): MessagePresentation {
  switch (phase) {
    case "review":
      return {
        icon: "↻",
        label: Number(n) === 1 ? "entered review loop" : `review loop ${n} — running`,
      }
    case "review-feedback":
      return { icon: "✎", label: "revising after review", detail: `iteration ${n}` }
    case "user-message":
      return { icon: "↪", label: "stage agent processing user message", detail: `iteration ${n}` }
    case "begin":
    default:
      return { icon: "▷", label: "stage agent working", detail: `iteration ${n}` }
  }
}

function tokenDetail(entry: MessageEntry): string {
  return [
    `in=${payloadNumberString(entry.payload.in, "0")} out=${payloadNumberString(entry.payload.out, "0")}`,
    typeof entry.payload.cached === "number" ? `cache=${entry.payload.cached}` : undefined,
    typeof entry.payload.provider === "string" ? entry.payload.provider : undefined,
    typeof entry.payload.model === "string" ? entry.payload.model : undefined,
  ].filter(Boolean).join(" ")
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
      return { icon: "→", label: "stage entered", detail: payloadString(entry.payload.stageKey) }
    case "phase_completed":
      return { icon: "✓", label: "stage done", detail: payloadString(entry.payload.stageKey) }
    case "phase_failed":
      return { icon: "✗", label: "stage failed", detail: payloadString(entry.payload.stageKey) }
    case "prompt_requested":
      return { icon: "?", label: "needs an answer", detail: payloadString(entry.payload.prompt) }
    case "prompt_answered":
      return { icon: "↩", label: "answer received", detail: payloadString(entry.payload.answer) }
    case "loop_iteration": {
      const n = payloadNumberString(entry.payload.n, "0")
      return iterationLabel(n, entry.payload.phase)
    }
    case "review_feedback":
      return {
        icon: "↩",
        label: `findings handed back to stage (cycle ${payloadNumberString(entry.payload.cycle, "1")})`,
        detail: payloadString(entry.payload.feedback),
      }
    case "tool_called":
      return {
        icon: "·",
        label: "tool call",
        detail: [
          payloadString(entry.payload.name),
          typeof entry.payload.provider === "string" ? `(${entry.payload.provider})` : undefined,
          typeof entry.payload.argsPreview === "string" ? `args=${entry.payload.argsPreview}` : undefined,
        ].filter(Boolean).join(" "),
      }
    case "tool_result":
      return {
        icon: "·",
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
        detail: tokenDetail(entry),
      }
    case "agent_message":
      return { icon: "🤖", label: "agent", detail: payloadString(entry.payload.text) }
    case "user_message":
      return { icon: "🧑", label: "user", detail: payloadString(entry.payload.text) }
    case "project_created":
      return { icon: "📚", label: "project", detail: payloadString(entry.payload.name) }
    case "wireframes_ready":
      return { icon: "🗺️", label: "wireframes", detail: payloadNumberString(entry.payload.screenCount, "—") }
    case "design_ready":
      return { icon: "🎨", label: "design", detail: payloadString(entry.payload.url) }
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
    case "merge_gate_open":
      return {
        icon: "⏸",
        label: "merge gate open — awaiting promotion",
        detail: branchTransitionDetail(entry),
      }
    case "merge_gate_cancelled":
      return {
        icon: "↶",
        label: "merge postponed",
        detail: branchTransitionDetail(entry),
      }
    case "merge_completed":
      return {
        icon: "⇪",
        label: "branch merged",
        detail: branchTransitionDetail(entry),
      }
    case "worktree_port_assigned":
      return {
        icon: "·",
        label: "preview port assigned",
        detail: `${payloadString(entry.payload.branch)} on :${payloadNumberString(entry.payload.port, "?")}`,
      }
    case "wave_serialized": {
      const stories = Array.isArray(entry.payload.stories) ? (entry.payload.stories as string[]).join(", ") : ""
      return {
        icon: "↺",
        label: "wave serialized (parallel → sequential)",
        detail: stories || payloadNumberString(entry.payload.waveNumber, "?"),
      }
    }
    case "presentation":
      return { icon: "✨", label: payloadString(entry.payload.text) }
    default: {
      // Switch is exhaustive over CanonicalMessageType; this branch only
      // fires if a new canonical type is added without a presentation case.
      return {
        icon: "·",
        label: String(entry.type).replaceAll("_", " "),
        detail: payloadString(entry.payload.rawType),
      }
    }
  }
}

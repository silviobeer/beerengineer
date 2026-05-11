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

function stringPayloadList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function startupRecoveryPresentation(entry: MessageEntry): MessagePresentation {
  const heldBackRunIds = stringPayloadList(entry.payload.heldBackRunIds)
  return {
    icon: "♻",
    label: "startup recovery",
    detail: [
      payloadString(entry.payload.outcome),
      payloadString(entry.payload.reason, ""),
      heldBackRunIds.length > 0 ? heldBackRunIds.join(", ") : undefined,
    ].filter(Boolean).join(" / "),
  }
}

function reviewFeedbackPresentation(entry: MessageEntry): MessagePresentation {
  return {
    icon: "↩",
    label: `findings handed back to stage (cycle ${payloadNumberString(entry.payload.cycle, "1")})`,
    detail: payloadString(entry.payload.feedback),
  }
}

function toolCalledPresentation(entry: MessageEntry): MessagePresentation {
  return {
    icon: "·",
    label: "tool call",
    detail: [
      payloadString(entry.payload.name),
      typeof entry.payload.provider === "string" ? `(${entry.payload.provider})` : undefined,
      typeof entry.payload.argsPreview === "string" ? `args=${entry.payload.argsPreview}` : undefined,
    ].filter(Boolean).join(" "),
  }
}

function toolResultPresentation(entry: MessageEntry): MessagePresentation {
  return {
    icon: "·",
    label: "tool result",
    detail: [
      payloadString(entry.payload.name),
      entry.payload.isError === true ? "(error)" : undefined,
      typeof entry.payload.resultPreview === "string" ? entry.payload.resultPreview : undefined,
    ].filter(Boolean).join(" "),
  }
}

function llmTokensPresentation(entry: MessageEntry): MessagePresentation {
  return {
    icon: "🔢",
    label: "tokens",
    detail: tokenDetail(entry),
  }
}

function worktreePortPresentation(entry: MessageEntry): MessagePresentation {
  return {
    icon: "·",
    label: "preview port assigned",
    detail: `${payloadString(entry.payload.branch)} on :${payloadNumberString(entry.payload.port, "?")}`,
  }
}

function waveSerializedPresentation(entry: MessageEntry): MessagePresentation {
  const stories = stringPayloadList(entry.payload.stories).join(", ")
  return {
    icon: "↺",
    label: "wave serialized (parallel → sequential)",
    detail: stories || payloadNumberString(entry.payload.waveNumber, "?"),
  }
}

const SIMPLE_PRESENTATIONS: Partial<Record<MessageEntry["type"], (entry: MessageEntry) => MessagePresentation>> = {
  run_started: entry => ({ icon: "🚀", label: "run started", detail: payloadString(entry.payload.title, entry.runId) }),
  run_finished: entry => ({ icon: "🏁", label: "run finished", detail: payloadString(entry.payload.status, "completed") }),
  run_failed: entry => ({ icon: "💥", label: "run failed", detail: payloadString(entry.payload.summary) }),
  run_blocked: entry => ({ icon: "🧱", label: "run blocked", detail: payloadString(entry.payload.summary) }),
  phase_started: entry => ({ icon: "→", label: "stage entered", detail: payloadString(entry.payload.stageKey) }),
  phase_completed: entry => ({ icon: "✓", label: "stage done", detail: payloadString(entry.payload.stageKey) }),
  phase_failed: entry => ({ icon: "✗", label: "stage failed", detail: payloadString(entry.payload.stageKey) }),
  prompt_requested: entry => ({ icon: "?", label: "needs an answer", detail: payloadString(entry.payload.prompt) }),
  prompt_answered: entry => ({ icon: "↩", label: "answer received", detail: payloadString(entry.payload.answer) }),
  llm_thinking: entry => ({ icon: "💭", label: "thinking", detail: payloadString(entry.payload.text) }),
  agent_message: entry => ({ icon: "🤖", label: "agent", detail: payloadString(entry.payload.text) }),
  user_message: entry => ({ icon: "🧑", label: "user", detail: payloadString(entry.payload.text) }),
  project_created: entry => ({ icon: "📚", label: "project", detail: payloadString(entry.payload.name) }),
  wireframes_ready: entry => ({ icon: "🗺️", label: "wireframes", detail: payloadNumberString(entry.payload.screenCount, "—") }),
  design_ready: entry => ({ icon: "🎨", label: "design", detail: payloadString(entry.payload.url) }),
  log: entry => ({ icon: "📎", label: "log", detail: payloadString(entry.payload.message) }),
  artifact_written: entry => ({ icon: "📝", label: "artifact", detail: payloadString(entry.payload.label) }),
  external_remediation_recorded: entry => ({ icon: "🩹", label: "remediation", detail: payloadString(entry.payload.summary) }),
  plan_regenerated: entry => ({ icon: "🧭", label: "plan regenerated", detail: payloadString(entry.payload.reason) }),
  item_column_changed: entry => ({
    icon: "📍",
    label: "item",
    detail: `${payloadString(entry.payload.column)} / ${payloadString(entry.payload.phaseStatus)}`,
  }),
  merge_gate_open: entry => ({
    icon: "⏸",
    label: "merge gate open — awaiting promotion",
    detail: branchTransitionDetail(entry),
  }),
  merge_gate_cancelled: entry => ({
    icon: "↶",
    label: "merge postponed",
    detail: branchTransitionDetail(entry),
  }),
  merge_completed: entry => ({
    icon: "⇪",
    label: "branch merged",
    detail: branchTransitionDetail(entry),
  }),
  presentation: entry => ({ icon: "✨", label: payloadString(entry.payload.text) }),
}

export type MessagePresentation = {
  icon: string
  label: string
  detail?: string
}

export function presentMessageEntry(entry: MessageEntry): MessagePresentation {
  if (entry.type === "run_resumed") {
    return { icon: "🪄", label: "run resumed" }
  }
  const simple = SIMPLE_PRESENTATIONS[entry.type]
  if (simple) return simple(entry)
  switch (entry.type) {
    case "startup_recovery":
      return startupRecoveryPresentation(entry)
    case "loop_iteration": {
      const n = payloadNumberString(entry.payload.n, "0")
      return iterationLabel(n, entry.payload.phase)
    }
    case "review_feedback":
      return reviewFeedbackPresentation(entry)
    case "tool_called":
      return toolCalledPresentation(entry)
    case "tool_result":
      return toolResultPresentation(entry)
    case "llm_tokens":
      return llmTokensPresentation(entry)
    case "worktree_port_assigned":
      return worktreePortPresentation(entry)
    case "wave_serialized":
      return waveSerializedPresentation(entry)
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

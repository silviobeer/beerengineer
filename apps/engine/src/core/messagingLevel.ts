import type { WorkflowEvent } from "./io.js"

export type MessagingLevel = 0 | 1 | 2

export type CanonicalMessageType =
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "run_blocked"
  | "run_resumed"
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "prompt_requested"
  | "prompt_answered"
  | "agent_message"
  | "user_message"
  | "loop_iteration"
  | "tool_called"
  | "tool_result"
  | "llm_thinking"
  | "llm_tokens"
  | "artifact_written"
  | "log"
  | "project_created"
  | "wireframes_ready"
  | "design_ready"
  | "external_remediation_recorded"
  | "item_column_changed"
  | "presentation"
  | "wave_serialized"
  | "merge_gate_open"
  | "merge_gate_cancelled"
  | "merge_completed"
  | "worktree_port_assigned"

export type LevelInfo = {
  level: MessagingLevel
  force: boolean
  type: CanonicalMessageType
}

function isFinalFacingAgentMessage(event: Extract<WorkflowEvent, { type: "chat_message" }>): boolean {
  return event.requiresResponse === true
}

export function levelOf(event: WorkflowEvent): LevelInfo {
  switch (event.type) {
    case "run_started":
      return { level: 2, force: false, type: "run_started" }
    case "run_finished":
      return { level: 2, force: false, type: "run_finished" }
    case "run_failed":
      return { level: 2, force: true, type: "run_failed" }
    case "run_blocked":
      return { level: 2, force: true, type: "run_blocked" }
    case "run_resumed":
      return { level: 2, force: false, type: "run_resumed" }
    case "external_remediation_recorded":
      return { level: 2, force: false, type: "external_remediation_recorded" }
    case "stage_started":
      return { level: 1, force: false, type: "phase_started" }
    case "stage_completed":
      return {
        level: 2,
        force: event.status === "failed",
        type: event.status === "failed" ? "phase_failed" : "phase_completed",
      }
    case "prompt_requested":
      return { level: 2, force: false, type: "prompt_requested" }
    case "prompt_answered":
      return { level: 1, force: false, type: "prompt_answered" }
    case "loop_iteration":
      return { level: 1, force: false, type: "loop_iteration" }
    case "tool_called":
      return { level: 1, force: false, type: "tool_called" }
    case "tool_result":
      return { level: 0, force: false, type: "tool_result" }
    case "llm_thinking":
      return { level: 0, force: false, type: "llm_thinking" }
    case "llm_tokens":
      return { level: 0, force: false, type: "llm_tokens" }
    case "chat_message":
      if (event.role === "user") return { level: 1, force: false, type: "user_message" }
      return {
        level: isFinalFacingAgentMessage(event) ? 1 : 0,
        force: false,
        type: "agent_message",
      }
    case "item_column_changed":
      // Not persisted to stage_logs today (runOrchestrator handles it as a
      // side-effect-only board update), so the read-side never sees it. The
      // classifier entry keeps the WorkflowEvent switch exhaustive so adding
      // persistence later can't regress without a compile error.
      return { level: 1, force: false, type: "item_column_changed" }
    case "project_created":
      return { level: 2, force: false, type: "project_created" }
    case "wireframes_ready":
      return { level: 2, force: false, type: "wireframes_ready" }
    case "design_ready":
      return { level: 2, force: false, type: "design_ready" }
    case "artifact_written":
      return { level: 0, force: false, type: "artifact_written" }
    case "log":
      return {
        level: event.level === "warn" || event.level === "error" ? 1 : 0,
        force: false,
        type: "log",
      }
    case "presentation":
      return { level: 0, force: false, type: "presentation" }
    case "wave_serialized":
      // Operator-relevant: we changed the planner's parallelism decision.
      // Stakeholder doesn't need it (no run-state implication), but an
      // operator watching at L1 should see why a parallel-eligible wave
      // ended up running sequentially.
      return { level: 1, force: false, type: "wave_serialized" }
    case "merge_gate_open":
      return { level: 1, force: false, type: "merge_gate_open" }
    case "merge_gate_cancelled":
      return { level: 1, force: false, type: "merge_gate_cancelled" }
    case "merge_completed":
      return { level: 1, force: false, type: "merge_completed" }
    case "worktree_port_assigned":
      return { level: 1, force: false, type: "worktree_port_assigned" }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function messagingLevelFromQuery(input: string | null | undefined, defaultLevel: MessagingLevel): MessagingLevel {
  if (!input) return defaultLevel
  const normalized = input.trim().toUpperCase()
  if (normalized === "L0" || normalized === "0") return 0
  if (normalized === "L1" || normalized === "1") return 1
  if (normalized === "L2" || normalized === "2") return 2
  return defaultLevel
}

export function shouldDeliverAtLevel(
  entry: Pick<LevelInfo, "level" | "force">,
  subscribedLevel: MessagingLevel,
): boolean {
  return entry.force || entry.level >= subscribedLevel
}

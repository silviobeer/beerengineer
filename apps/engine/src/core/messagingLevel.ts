import type { WorkflowEvent } from "./io.js"

export type MessagingLevel = 0 | 1 | 2

export type CanonicalMessageType =
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "run_blocked"
  | "dirty_master_allowlist_restore"
  | "startup_recovery"
  | "run_resumed"
  | "run_recovery_action"
  | "plan_regenerated"
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "prompt_requested"
  | "prompt_answered"
  | "agent_message"
  | "user_message"
  | "loop_iteration"
  | "review_feedback"
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
  | "run_recovery_action"
  | "item_column_changed"
  | "presentation"
  | "wave_serialized"
  | "merge_gate_open"
  | "merge_gate_cancelled"
  | "merge_completed"
  | "worktree_port_assigned"
  | "supabase.branch.provisioning_started"
  | "supabase.branch.ready"
  | "supabase.branch.migration_started"
  | "supabase.branch.migration_passed"
  | "supabase.branch.seed_started"
  | "supabase.branch.seed_passed"
  | "supabase.branch.db_tests_started"
  | "supabase.branch.db_tests_passed"
  | "supabase.branch.failed"
  | "supabase.branch.retained"
  | "supabase.branch.destroying"
  | "supabase.branch.destroyed"
  | "supabase.operator.action"

export type LevelInfo = {
  level: MessagingLevel
  force: boolean
  type: CanonicalMessageType
}

const SIMPLE_EVENT_TYPES = [
  "run_started",
  "run_finished",
  "run_failed",
  "run_blocked",
  "dirty_master_allowlist_restore",
  "run_resumed",
  "run_recovery_action",
  "plan_regenerated",
  "external_remediation_recorded",
  "stage_started",
  "prompt_requested",
  "prompt_answered",
  "review_feedback",
  "tool_called",
  "tool_result",
  "llm_thinking",
  "llm_tokens",
  "item_column_changed",
  "project_created",
  "wireframes_ready",
  "design_ready",
  "artifact_written",
  "presentation",
  "wave_serialized",
  "merge_gate_open",
  "merge_gate_cancelled",
  "merge_completed",
  "worktree_port_assigned",
  "supabase_operator_action",
] as const satisfies ReadonlyArray<WorkflowEvent["type"]>

type SimpleEventType = typeof SIMPLE_EVENT_TYPES[number]

const SIMPLE_EVENT_TYPE_SET = new Set<WorkflowEvent["type"]>(SIMPLE_EVENT_TYPES)

const SIMPLE_LEVELS_BY_EVENT: Record<SimpleEventType, LevelInfo> = {
  run_started: { level: 2, force: false, type: "run_started" },
  run_finished: { level: 2, force: false, type: "run_finished" },
  run_failed: { level: 2, force: true, type: "run_failed" },
  run_blocked: { level: 2, force: true, type: "run_blocked" },
  dirty_master_allowlist_restore: { level: 1, force: false, type: "dirty_master_allowlist_restore" },
  run_resumed: { level: 2, force: false, type: "run_resumed" },
  run_recovery_action: { level: 1, force: false, type: "run_recovery_action" },
  plan_regenerated: { level: 2, force: false, type: "plan_regenerated" },
  external_remediation_recorded: { level: 2, force: false, type: "external_remediation_recorded" },
  stage_started: { level: 1, force: false, type: "phase_started" },
  prompt_requested: { level: 2, force: false, type: "prompt_requested" },
  prompt_answered: { level: 1, force: false, type: "prompt_answered" },
  review_feedback: { level: 1, force: false, type: "review_feedback" },
  tool_called: { level: 0, force: false, type: "tool_called" },
  tool_result: { level: 0, force: false, type: "tool_result" },
  llm_thinking: { level: 0, force: false, type: "llm_thinking" },
  llm_tokens: { level: 0, force: false, type: "llm_tokens" },
  item_column_changed: { level: 1, force: false, type: "item_column_changed" },
  project_created: { level: 2, force: false, type: "project_created" },
  wireframes_ready: { level: 2, force: false, type: "wireframes_ready" },
  design_ready: { level: 2, force: false, type: "design_ready" },
  artifact_written: { level: 0, force: false, type: "artifact_written" },
  presentation: { level: 0, force: false, type: "presentation" },
  wave_serialized: { level: 1, force: false, type: "wave_serialized" },
  merge_gate_open: { level: 1, force: false, type: "merge_gate_open" },
  merge_gate_cancelled: { level: 1, force: false, type: "merge_gate_cancelled" },
  merge_completed: { level: 1, force: false, type: "merge_completed" },
  worktree_port_assigned: { level: 1, force: false, type: "worktree_port_assigned" },
  supabase_operator_action: { level: 1, force: false, type: "supabase.operator.action" },
}

type SimpleEvent = Extract<WorkflowEvent, { type: SimpleEventType }>

function isSimpleEvent(event: WorkflowEvent): event is SimpleEvent {
  return SIMPLE_EVENT_TYPE_SET.has(event.type)
}

function isFinalFacingAgentMessage(event: Extract<WorkflowEvent, { type: "chat_message" }>): boolean {
  return event.requiresResponse === true || event.source === "reviewer"
}

function startupRecoveryLevel(event: Extract<WorkflowEvent, { type: "startup_recovery" }>): LevelInfo {
  return { level: 2, force: event.outcome === "failed", type: "startup_recovery" }
}

function stageCompletedLevel(event: Extract<WorkflowEvent, { type: "stage_completed" }>): LevelInfo {
  return {
    level: 2,
    force: event.status === "failed",
    type: event.status === "failed" ? "phase_failed" : "phase_completed",
  }
}

function loopIterationLevel(event: Extract<WorkflowEvent, { type: "loop_iteration" }>): LevelInfo {
  return {
    level: event.phase === "review" && event.n === 1 ? 2 : 1,
    force: false,
    type: "loop_iteration",
  }
}

function chatMessageLevel(event: Extract<WorkflowEvent, { type: "chat_message" }>): LevelInfo {
  if (event.role === "user") return { level: 1, force: false, type: "user_message" }
  return {
    level: isFinalFacingAgentMessage(event) ? 1 : 0,
    force: false,
    type: "agent_message",
  }
}

function logLevel(event: Extract<WorkflowEvent, { type: "log" }>): LevelInfo {
  return {
    level: event.level === "warn" || event.level === "error" ? 1 : 0,
    force: false,
    type: "log",
  }
}

function supabaseBranchLifecycleLevel(
  event: Extract<WorkflowEvent, { type: "supabase_branch_lifecycle" }>,
): LevelInfo {
  return {
    level: 1,
    force: event.status === "failed" || event.status === "retained",
    type: supabaseLifecycleMessageType(event),
  }
}

export function levelOf(event: WorkflowEvent): LevelInfo {
  if (isSimpleEvent(event)) return SIMPLE_LEVELS_BY_EVENT[event.type]

  switch (event.type) {
    case "startup_recovery":
      return startupRecoveryLevel(event)
    case "stage_completed":
      return stageCompletedLevel(event)
    case "loop_iteration":
      return loopIterationLevel(event)
    case "chat_message":
      return chatMessageLevel(event)
    case "log":
      return logLevel(event)
    case "supabase_branch_lifecycle":
      return supabaseBranchLifecycleLevel(event)
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function supabaseLifecycleMessageType(event: Extract<WorkflowEvent, { type: "supabase_branch_lifecycle" }>): CanonicalMessageType {
  if (event.status === "failed") return "supabase.branch.failed"
  if (event.status === "retained") return "supabase.branch.retained"
  if (event.step === "branch_creation" && event.status === "in_progress") return "supabase.branch.provisioning_started"
  if (event.step === "branch_creation" && event.status === "passed") return "supabase.branch.ready"
  if (event.step === "migrations" && event.status === "in_progress") return "supabase.branch.migration_started"
  if (event.step === "migrations" && event.status === "passed") return "supabase.branch.migration_passed"
  if (event.step === "seed" && event.status === "in_progress") return "supabase.branch.seed_started"
  if (event.step === "seed" && event.status === "passed") return "supabase.branch.seed_passed"
  if (event.step === "db_tests" && event.status === "in_progress") return "supabase.branch.db_tests_started"
  if (event.step === "db_tests" && event.status === "passed") return "supabase.branch.db_tests_passed"
  if (event.step === "cleanup" && event.status === "in_progress") return "supabase.branch.destroying"
  if (event.step === "cleanup" && event.status === "passed") return "supabase.branch.destroyed"
  return "supabase.branch.retained"
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

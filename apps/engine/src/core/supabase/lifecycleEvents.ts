import type { Repos } from "../../db/repositories.js"
import { emitEvent } from "../runContext.js"
import { hasWorkflowIO } from "../io.js"
import type { WorkflowEvent } from "../io.js"

export type SupabaseLifecycleEvent = Extract<WorkflowEvent, { type: "supabase_branch_lifecycle" }>
export type SupabaseLifecycleStep = SupabaseLifecycleEvent["step"]
export type SupabaseLifecycleStatus = SupabaseLifecycleEvent["status"]

export function recordSupabaseLifecycle(input: {
  repos?: Repos
  runId?: string | null
  waveId?: string | null
  branchRef?: string | null
  step: SupabaseLifecycleStep
  status: SupabaseLifecycleStatus
  reason?: string
  timestamp?: number
}): SupabaseLifecycleEvent | null {
  if (!input.runId) return null
  const event: SupabaseLifecycleEvent = {
    type: "supabase_branch_lifecycle",
    runId: input.runId,
    waveId: input.waveId ?? null,
    branchRef: input.branchRef ?? null,
    step: input.step,
    status: input.status,
    reason: input.reason,
    timestamp: input.timestamp ?? Date.now(),
  }
  if (hasWorkflowIO()) {
    emitEvent(event)
  } else {
    input.repos?.appendLog({
      runId: event.runId,
      eventType: "supabase_branch_lifecycle",
      message: `${event.step} ${event.status}`,
      data: {
        waveId: event.waveId ?? null,
        branchRef: event.branchRef ?? null,
        step: event.step,
        status: event.status,
        reason: event.reason,
        timestamp: event.timestamp,
      },
    })
  }
  return event
}

export function recordSupabaseOperatorAction(input: {
  repos: Repos
  runId: string
  workspaceId: string
  branchRef: string
  action: Extract<WorkflowEvent, { type: "supabase_operator_action" }>["action"]
  workspaceLocalOperatorId?: string
  outcome?: "accepted" | "rejected"
  reason?: string
  timestamp?: number
}): Extract<WorkflowEvent, { type: "supabase_operator_action" }> {
  const event: Extract<WorkflowEvent, { type: "supabase_operator_action" }> = {
    type: "supabase_operator_action",
    runId: input.runId,
    workspaceId: input.workspaceId,
    branchRef: input.branchRef,
    action: input.action,
    workspaceLocalOperatorId: input.workspaceLocalOperatorId ?? "local-operator",
    outcome: input.outcome,
    reason: input.reason,
    timestamp: input.timestamp ?? Date.now(),
  }
  if (hasWorkflowIO()) {
    emitEvent(event)
  } else {
    input.repos.appendLog({
      runId: event.runId,
      eventType: "supabase_operator_action",
      message: `${event.action} ${event.branchRef}`,
      data: {
        workspaceId: event.workspaceId,
        branchRef: event.branchRef,
        action: event.action,
        workspaceLocalOperatorId: event.workspaceLocalOperatorId,
        outcome: event.outcome,
        reason: event.reason,
        timestamp: event.timestamp,
      },
    })
  }
  return event
}

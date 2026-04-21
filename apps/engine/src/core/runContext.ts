import { randomUUID } from "node:crypto"
import { getWorkflowIO, hasWorkflowIO, type WorkflowEvent } from "./io.js"

/**
 * Active run context — set by the orchestrator (or test harness) before
 * invoking runWorkflow(). Lets stages emit events without threading the
 * runId through every signature.
 */
type RunContext = { runId: string; itemId: string }
let current: RunContext | null = null

export function setActiveRun(ctx: RunContext | null): void {
  current = ctx
}

export function getActiveRun(): RunContext | null {
  return current
}

export function emitEvent(event: WorkflowEvent): void {
  if (!hasWorkflowIO()) return
  getWorkflowIO().emit(event)
}

/**
 * Wrap a stage invocation with start/completed lifecycle events.
 * Safe to use without an active IO (becomes a no-op wrapper).
 */
export async function withStageLifecycle<T>(
  stageKey: string,
  opts: { projectId?: string | null } = {},
  fn: () => Promise<T>
): Promise<T> {
  if (!current || !hasWorkflowIO()) {
    return fn()
  }
  const stageRunId = randomUUID() // placeholder — DB-side id is assigned in sync layer
  emitEvent({ type: "stage_started", runId: current.runId, stageRunId, stageKey, projectId: opts.projectId ?? null })
  try {
    const result = await fn()
    emitEvent({ type: "stage_completed", runId: current.runId, stageRunId, stageKey, status: "completed" })
    return result
  } catch (err) {
    emitEvent({
      type: "stage_completed",
      runId: current.runId,
      stageRunId,
      stageKey,
      status: "failed",
      error: (err as Error).message
    })
    throw err
  }
}

import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { getWorkflowIO, hasWorkflowIO, type WorkflowEvent } from "./io.js"

/**
 * Active run context — set by the orchestrator (or test harness) before
 * invoking runWorkflow(). Lets stages emit events without threading the
 * runId through every signature.
 */
type RunContext = { runId: string; itemId: string; stageRunId?: string | null }
const runContextStorage = new AsyncLocalStorage<RunContext>()

export function runWithActiveRun<T>(ctx: RunContext, fn: () => T): T {
  return runContextStorage.run(ctx, fn)
}

export function getActiveRun(): RunContext | null {
  return runContextStorage.getStore() ?? null
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
  const current = getActiveRun()
  if (!current || !hasWorkflowIO()) {
    return fn()
  }
  const stageRunId = randomUUID()
  return runWithActiveRun({ ...current, stageRunId }, async () => {
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
  })
}

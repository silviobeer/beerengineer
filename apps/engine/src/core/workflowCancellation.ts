import { AsyncLocalStorage } from "node:async_hooks"
import type { WorkflowIO } from "./io.js"

export type WorkflowCancellationReason = "lost_ownership" | "heartbeat_failures"

export class WorkflowCancelledError extends Error {
  constructor(readonly reason: WorkflowCancellationReason, cause?: Error) {
    super(`workflow_cancelled:${reason}${cause ? `:${cause.message}` : ""}`)
    this.name = "WorkflowCancelledError"
  }
}

export function isWorkflowCancelledError(error: unknown): error is WorkflowCancelledError {
  return error instanceof WorkflowCancelledError
}

export type WorkflowCancellation = {
  cancel(reason: WorkflowCancellationReason, cause?: Error): void
  throwIfCancelled(): void
  waitForCancellation(): Promise<never>
  readonly cancelled: boolean
  readonly reason: WorkflowCancellationReason | null
}

const workflowCancellationStorage = new AsyncLocalStorage<WorkflowCancellation>()

export function createWorkflowCancellation(): WorkflowCancellation {
  let error: WorkflowCancelledError | null = null
  let rejectWaiters: Array<(error: WorkflowCancelledError) => void> = []

  return {
    cancel(reason, cause) {
      if (error) return
      error = new WorkflowCancelledError(reason, cause)
      for (const reject of rejectWaiters) reject(error)
      rejectWaiters = []
    },
    throwIfCancelled() {
      if (error) throw error
    },
    waitForCancellation() {
      if (error) return Promise.reject(error)
      return new Promise<never>((_, reject) => {
        rejectWaiters.push(reject)
      })
    },
    get cancelled() {
      return error !== null
    },
    get reason() {
      return error?.reason ?? null
    },
  }
}

export function runWithWorkflowCancellation<T>(cancellation: WorkflowCancellation, fn: () => T): T {
  return workflowCancellationStorage.run(cancellation, fn)
}

export function assertWorkflowNotCancelled(): void {
  workflowCancellationStorage.getStore()?.throwIfCancelled()
}

export function withWorkflowCancellation<T extends WorkflowIO>(
  io: T,
  cancellation: WorkflowCancellation,
): T {
  return {
    ...io,
    async ask(prompt, opts) {
      cancellation.throwIfCancelled()
      const answer = await Promise.race([
        io.ask(prompt, opts),
        cancellation.waitForCancellation(),
      ])
      cancellation.throwIfCancelled()
      return answer
    },
    emit(event) {
      cancellation.throwIfCancelled()
      io.emit(event)
    },
    close: io.close ? () => io.close?.() : undefined,
  }
}

import { EventEmitter } from "node:events"
import { getWorkflowIO, hasWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { getActiveRun } from "./runContext.js"
import type { Repos } from "../db/repositories.js"

export type ApiIOSession = {
  readonly io: WorkflowIO
  readonly emitter: EventEmitter
  /** Resolve the answer for a pending prompt. Returns false if the
   *  promptId is unknown. */
  answerPrompt(promptId: string, answer: string): boolean
  dispose(): void
}

/**
 * Create an IO session for the API layer. The session has no notion of a
 * runId on its own — the runId is read from the AsyncLocalStorage active-run
 * context at the moment a prompt is asked. The orchestrator wraps every
 * workflow run in `runWithActiveRun({ runId, ... })`, so any `ask()` issued
 * inside that scope sees the correct id.
 */
export function createApiIOSession(repos: Repos): ApiIOSession {
  const emitter = new EventEmitter()
  const pending = new Map<string, (answer: string) => void>()

  const requireRunId = (): string => {
    const active = getActiveRun()
    if (!active) {
      throw new Error("ApiIOSession used outside of an active run context")
    }
    return active.runId
  }

  /** Route the broadcast event through the *active* workflow IO so any
   *  composed wrapper (e.g. db-sync) sees it. Falls back to the raw emitter
   *  when no active workflow context exists (e.g. unit tests). */
  const broadcast = (event: WorkflowEvent): void => {
    if (hasWorkflowIO()) {
      getWorkflowIO().emit(event)
    } else {
      emitter.emit("event", event)
    }
  }

  const io: WorkflowIO = {
    ask(prompt: string): Promise<string> {
      const runId = requireRunId()
      const promptRow = repos.createPendingPrompt({ runId, prompt })
      broadcast({
        type: "prompt_requested",
        runId,
        promptId: promptRow.id,
        prompt
      } satisfies WorkflowEvent)
      return new Promise<string>(resolve => {
        pending.set(promptRow.id, resolve)
      })
    },
    emit(event: WorkflowEvent): void {
      emitter.emit("event", event)
    },
    close(): void {
      for (const resolve of pending.values()) resolve("")
      pending.clear()
    }
  }

  return {
    io,
    emitter,
    answerPrompt(promptId, answer) {
      const resolver = pending.get(promptId)
      if (!resolver) return false
      pending.delete(promptId)
      const row = repos.answerPendingPrompt(promptId, answer)
      if (row) {
        // No active-run context here (we're in an HTTP handler), so look up
        // the runId from the prompt row itself, and emit through the broadcast
        // path so the db-sync wrapper sees it too.
        broadcast({
          type: "prompt_answered",
          runId: row.run_id,
          promptId,
          answer
        } satisfies WorkflowEvent)
      }
      resolver(answer)
      return true
    },
    dispose() {
      emitter.removeAllListeners()
      pending.clear()
    }
  }
}

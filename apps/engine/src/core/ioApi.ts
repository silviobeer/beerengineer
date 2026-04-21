import { EventEmitter } from "node:events"
import type { WorkflowEvent, WorkflowIO } from "./io.js"
import type { Repos } from "../db/repositories.js"

export type ApiIOSession = {
  runId: string
  setRunId(id: string): void
  readonly io: WorkflowIO
  readonly emitter: EventEmitter
  answerPrompt(promptId: string, answer: string): boolean
  dispose(): void
}

export function createApiIOSession(initialRunId: string, repos: Repos): ApiIOSession {
  const emitter = new EventEmitter()
  const pending = new Map<string, (answer: string) => void>()
  let currentRunId = initialRunId

  const io: WorkflowIO = {
    ask(prompt: string): Promise<string> {
      const promptRow = repos.createPendingPrompt({ runId: currentRunId, prompt })
      // Route via io.emit so any db-sync wrapper sees this event (and the
      // wrapper's originalEmit delegates to emitter.emit for SSE fanout).
      io.emit({
        type: "prompt_requested",
        runId: currentRunId,
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
    get runId() {
      return currentRunId
    },
    set runId(id: string) {
      currentRunId = id
    },
    setRunId(id) {
      currentRunId = id
    },
    io,
    emitter,
    answerPrompt(promptId, answer) {
      const resolver = pending.get(promptId)
      if (!resolver) return false
      pending.delete(promptId)
      const row = repos.answerPendingPrompt(promptId, answer)
      if (row) {
        emitter.emit("event", {
          type: "prompt_answered",
          runId: currentRunId,
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

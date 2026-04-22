import { EventEmitter } from "node:events"
import { createBus, busToWorkflowIO, type EventBus } from "./bus.js"
import { withPromptPersistence } from "./promptPersistence.js"
import type { WorkflowEvent, WorkflowIO } from "./io.js"
import type { Repos } from "../db/repositories.js"

export type ApiIOSession = {
  readonly io: WorkflowIO & { bus: EventBus }
  readonly emitter: EventEmitter
  readonly bus: EventBus
  /** Resolve the answer for a pending prompt by emitting `prompt_answered`
   *  on the bus. Returns false only if the prompt is not tracked by *any*
   *  session or pending_prompts row. */
  answerPrompt(promptId: string, answer: string): boolean
  dispose(): void
}

/**
 * Create an IO session for the API layer. The session owns the bus and the
 * two subscribers that are transport-level obligations for anything that
 * issues prompts through the API:
 *
 *   1. `withPromptPersistence` — mirrors every `prompt_requested` into the
 *      shared `pending_prompts` table so `GET /runs/:id/prompts` works and
 *      the UI's input panel can find it. Marks the row answered when a
 *      matching `prompt_answered` flows through.
 *   2. A legacy `EventEmitter` bridge so existing SSE handlers that consumed
 *      `session.emitter.on("event", …)` keep working unchanged.
 *
 * DB projection (`attachDbSync`) and cross-process answer routing are still
 * attached by `prepareRun` / `performResume`, because they are run-scoped
 * concerns and the session factory doesn't know runId yet.
 */
export function createApiIOSession(repos: Repos): ApiIOSession {
  const bus = createBus()
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  const detachPersistence = withPromptPersistence(bus, repos)
  // Bridge bus -> emitter so existing `emitter.on("event", …)` consumers
  // (board stream, legacy code) keep working. They become just another
  // subscriber on the bus.
  const detachBridge = bus.subscribe((event: WorkflowEvent) => {
    emitter.emit("event", event)
  })

  const io = busToWorkflowIO(bus)

  return {
    io,
    emitter,
    bus,
    answerPrompt(promptId, answer) {
      // `bus.answer` returns true iff the promptId has a pending request
      // in *this* process. That's the in-memory case — the UI answering a
      // live API-owned run.
      if (bus.answer(promptId, answer)) return true

      // No in-memory pending request — this is either a CLI-owned run
      // (another process holds the pending promise) or a stale session. The
      // caller (HTTP handler) is responsible for updating `pending_prompts`
      // and writing a `prompt_answered` stage_log row; see `handleRunInput`
      // in `api/server.ts`. We return false so the handler falls back to
      // that shared-transport write path.
      return false
    },
    dispose() {
      detachBridge()
      detachPersistence()
      emitter.removeAllListeners()
      bus.close()
    },
  }
}

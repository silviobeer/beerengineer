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
 * Build a bus-backed IO session with prompt persistence attached, plus an
 * EventEmitter bridge for legacy SSE glue. Production run hosting uses
 * `core/runService.ts → buildApiIo`; this helper stays because the test
 * suite exercises the bus + persistence wiring through it, and the
 * `ioContract` test checks that it implements `WorkflowIO`.
 */
export function createApiIOSession(repos: Repos): ApiIOSession {
  const bus = createBus()
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  const detachPersistence = withPromptPersistence(bus, repos)
  const detachBridge = bus.subscribe((event: WorkflowEvent) => {
    emitter.emit("event", event)
  })

  const io = busToWorkflowIO(bus)

  return {
    io,
    emitter,
    bus,
    answerPrompt(promptId, answer) {
      return bus.answer(promptId, answer)
    },
    dispose() {
      detachBridge()
      detachPersistence()
      bus.close()
      emitter.removeAllListeners()
    },
  }
}

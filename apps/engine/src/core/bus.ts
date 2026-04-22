import { EventEmitter } from "node:events"
import { type WorkflowEvent, type WorkflowIO } from "./io.js"
import { getActiveRun } from "./runContext.js"

/**
 * The event bus is the single abstraction for workflow output and input.
 *
 * - `emit()` publishes an event to every subscriber.
 * - `subscribe()` attaches a listener (returns an unsubscribe fn).
 * - `request()` is a round-trip helper: emit `prompt_requested`, wait until
 *   some subscriber emits (or `answer()`s) the matching `prompt_answered`.
 *
 * Renderers (humanCli, NDJSON, SSE, DB sync, prompt persistence) all attach
 * as subscribers. Prompts are bus events, not a separate interface.
 *
 * There is deliberately **no** re-entry through `getWorkflowIO()` in here:
 * middleware (dbSync, prompt persistence, cross-process bridge) subscribes
 * to the bus directly, so a single `emit()` reaches every subscriber once.
 */
export type EventBus = {
  emit(event: WorkflowEvent): void
  subscribe(listener: (event: WorkflowEvent) => void): () => void
  /** Request a prompt answer. The bus emits `prompt_requested`; the promise
   *  resolves when someone emits the matching `prompt_answered` (or calls
   *  `answer()`, which just emits on your behalf). */
  request(prompt: string, opts?: { promptId?: string; runId?: string; stageRunId?: string | null }): Promise<string>
  /** Emit a `prompt_answered` event to resolve a pending request. Returns
   *  false if the promptId is not pending. */
  answer(promptId: string, answer: string): boolean
  /** Cancel all pending requests (resolves with empty string). */
  close(): void
}

let counter = 0
function newPromptId(): string {
  counter += 1
  return `p-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function createBus(): EventBus {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)
  const pending = new Map<string, {
    resolve: (answer: string) => void
    runId: string
  }>()

  const emit = (event: WorkflowEvent): void => {
    emitter.emit("event", event)
    // Resolve any pending `request()` whose promptId matches. Any subscriber
    // that wants to answer a prompt just emits `prompt_answered` — no
    // separate signalling mechanism is needed.
    if (event.type === "prompt_answered") {
      const request = pending.get(event.promptId)
      if (request) {
        pending.delete(event.promptId)
        request.resolve(event.answer)
      }
    }
  }

  const subscribe = (listener: (event: WorkflowEvent) => void): () => void => {
    emitter.on("event", listener)
    return () => emitter.off("event", listener)
  }

  const request: EventBus["request"] = async (prompt, opts) => {
    const promptId = opts?.promptId ?? newPromptId()
    const active = getActiveRun()
    const runId = opts?.runId ?? active?.runId ?? "no-run"
    const stageRunId = opts?.stageRunId ?? active?.stageRunId ?? null
    return new Promise<string>(resolve => {
      pending.set(promptId, { resolve, runId })
      emit({
        type: "prompt_requested",
        runId,
        promptId,
        prompt,
        stageRunId,
      })
    })
  }

  const answer: EventBus["answer"] = (promptId, answer) => {
    const request = pending.get(promptId)
    if (!request) return false
    emit({
      type: "prompt_answered",
      runId: request.runId,
      promptId,
      answer,
    })
    return true
  }

  const close: EventBus["close"] = () => {
    for (const request of pending.values()) request.resolve("")
    pending.clear()
    emitter.removeAllListeners()
  }

  return { emit, subscribe, request, answer, close }
}

/**
 * Adapt a bus to the legacy `WorkflowIO` shape. `ask` routes through the
 * bus's request/answer cycle; `emit` is a thin pass-through. The returned
 * io also exposes `.bus` so orchestrators can attach subscribers.
 */
export function busToWorkflowIO(bus: EventBus): WorkflowIO & { bus: EventBus } {
  return {
    ask: (prompt: string) => bus.request(prompt),
    emit: (event: WorkflowEvent) => bus.emit(event),
    close: () => bus.close(),
    bus,
  }
}

import { emitEvent, getActiveRun } from "../../../core/runContext.js"

export type StreamEventSummary = { kind: "dim" | "step"; text: string }

type JsonLineStreamOptions<TEvent> = {
  onEvent?: (event: TEvent) => void
  summarize: (event: TEvent) => StreamEventSummary | null
}

export function makeJsonLineStreamCallback<TEvent>(options: JsonLineStreamOptions<TEvent>): (line: string) => void {
  return (line: string) => {
    let event: TEvent
    try {
      event = JSON.parse(line) as TEvent
    } catch {
      return
    }
    options.onEvent?.(event)
    const summary = options.summarize(event)
    if (!summary) return
    const active = getActiveRun()
    if (!active) return
    emitEvent({
      type: "presentation",
      runId: active.runId,
      stageRunId: active.stageRunId ?? null,
      kind: summary.kind,
      text: summary.text,
    })
  }
}

export function emitRetryMarker(provider: string, attemptNumber: number, maxAttempts: number, delayMs: number): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "presentation",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    kind: "dim",
    text: `${provider}: local retry ${attemptNumber}/${maxAttempts} in ${delayMs} ms`,
  })
}

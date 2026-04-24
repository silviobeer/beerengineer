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

export function emitHostedToolCalled(name: string, argsPreview?: string, provider?: string): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "tool_called",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    name,
    argsPreview,
    provider,
  })
}

export function emitHostedToolResult(name: string, argsPreview?: string, resultPreview?: string, provider?: string, isError = false): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "tool_result",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    name,
    argsPreview,
    resultPreview,
    provider,
    isError,
  })
}

export function emitHostedThinking(text: string, provider?: string, model?: string): void {
  const active = getActiveRun()
  if (!active || !text.trim()) return
  emitEvent({
    type: "llm_thinking",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    text: text.trim(),
    provider,
    model,
  })
}

export function emitHostedTokens(inputTokens: number, outputTokens: number, cached = 0, provider?: string, model?: string): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "llm_tokens",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    in: inputTokens,
    out: outputTokens,
    cached,
    provider,
    model,
  })
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

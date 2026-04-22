import * as readline from "node:readline"
import type { EventBus } from "../bus.js"
import type { WorkflowEvent } from "../io.js"

/**
 * NDJSON renderer — one JSON event per line to stdout, one answer per line
 * from stdin. This is the harness transport: agents read the event stream
 * and reply to `prompt_requested` with `{"type":"prompt_answered","promptId":"…","answer":"…"}`.
 *
 * Diagnostic output intentionally stays off stdout (callers should route
 * human formatting to stderr or disable it entirely in --json mode).
 */
export function attachNdjsonRenderer(
  bus: EventBus,
  opts: { out?: NodeJS.WritableStream; in?: NodeJS.ReadableStream } = {},
): () => void {
  const out = opts.out ?? process.stdout
  const input = opts.in ?? process.stdin

  const unsubscribe = bus.subscribe((event: WorkflowEvent) => {
    try {
      out.write(`${JSON.stringify(event)}\n`)
    } catch (err) {
      // stdout write shouldn't crash the workflow; log to stderr and carry on.
      process.stderr.write(`[ndjson] failed to serialize event: ${(err as Error).message}\n`)
    }
  })

  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  rl.on("line", line => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    try {
      const msg = JSON.parse(trimmed) as { type?: string; promptId?: string; runId?: string; answer?: string }
      if (msg.type === "prompt_answered" && typeof msg.promptId === "string" && typeof msg.answer === "string") {
        // Resolve through the bus so the resulting `prompt_answered` event
        // keeps the original request's run metadata and flows through the
        // same subscribers as any other workflow event.
        if (!bus.answer(msg.promptId, msg.answer) && typeof msg.runId === "string") {
          bus.emit({
            type: "prompt_answered",
            runId: msg.runId,
            promptId: msg.promptId,
            answer: msg.answer,
          })
        }
      }
    } catch (err) {
      process.stderr.write(`[ndjson] invalid input line (ignored): ${(err as Error).message}\n`)
    }
  })

  return () => {
    unsubscribe()
    rl.close()
  }
}

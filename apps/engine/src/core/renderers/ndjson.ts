import * as readline from "node:readline"
import type { EventBus } from "../bus.js"
import type { WorkflowEvent } from "../io.js"

/**
 * Events an external agent harness needs to react to. Anything outside this
 * set is lifecycle breadcrumbs / presentation chatter that an agent shouldn't
 * have to filter. In "agent" mode we emit only these; in "firehose" mode we
 * mirror everything.
 */
const AGENT_EVENT_TYPES: ReadonlySet<WorkflowEvent["type"]> = new Set<WorkflowEvent["type"]>([
  "prompt_requested",
  "prompt_answered",
  "run_started",
  "run_finished",
  "run_blocked",
  "run_failed",
])

export type NdjsonMode = "agent" | "firehose"

export type NdjsonOptions = {
  out?: NodeJS.WritableStream
  err?: NodeJS.WritableStream
  in?: NodeJS.ReadableStream
  /**
   * "agent": emit only events an external agent acts on + a one-shot
   *   `workflow_started` protocol banner, and write a compact stderr
   *   signpost every time the workflow is waiting on a prompt.
   * "firehose": mirror every bus event to stdout (legacy / debugging).
   */
  mode?: NdjsonMode
}

/**
 * NDJSON renderer. Stdout carries JSON events; stdin accepts JSON answers.
 *
 *   → stdout  {"type":"prompt_requested","runId":"…","promptId":"…","prompt":"…"}
 *   ← stdin   {"type":"prompt_answered","promptId":"…","answer":"…"}
 *
 * In "agent" mode (the default for `beerengineer run --json`):
 *   - stdout is filtered to agent-relevant events only (see AGENT_EVENT_TYPES)
 *     plus a one-shot `workflow_started` banner that documents the reply
 *     protocol, so a newly-attached harness doesn't need to read source to
 *     wire itself up.
 *   - stderr receives a compact signpost whenever a `prompt_requested`
 *     fires, so shell wrappers and humans without a JSON parser notice
 *     that the workflow is waiting on input.
 *   - stdin lines parse as `{type:"prompt_answered", promptId, answer}`.
 */
export function attachNdjsonRenderer(bus: EventBus, opts: NdjsonOptions = {}): () => void {
  const out = opts.out ?? process.stdout
  const err = opts.err ?? process.stderr
  const input = opts.in ?? process.stdin
  const mode: NdjsonMode = opts.mode ?? "agent"

  const emitLine = (payload: Record<string, unknown>): void => {
    try {
      out.write(`${JSON.stringify(payload)}\n`)
    } catch (writeErr) {
      err.write(`[ndjson] failed to serialize event: ${(writeErr as Error).message}\n`)
    }
  }

  // H5 — Handshake banner so a newly-attached harness learns the protocol
  // without reading source. Emitted exactly once, immediately on attach.
  if (mode === "agent") {
    emitLine({
      type: "workflow_started",
      version: 1,
      protocol: {
        wake_on: ["prompt_requested"],
        reply: '{"type":"prompt_answered","promptId":"<from prompt_requested>","answer":"<your answer>"}',
        terminal_events: ["run_finished", "run_blocked", "run_failed", "cli_finished"],
      },
    })
  }

  const unsubscribe = bus.subscribe((event: WorkflowEvent) => {
    if (mode === "agent" && !AGENT_EVENT_TYPES.has(event.type)) return
    emitLine(event as unknown as Record<string, unknown>)

    // H6 — Stderr signpost so blocking state is visible even to agents /
    // scripts that don't parse stdout JSON.
    if (mode === "agent" && event.type === "prompt_requested") {
      const promptText = event.prompt.length > 120 ? `${event.prompt.slice(0, 117)}…` : event.prompt
      err.write(`⏸  beerengineer waiting on prompt [${event.promptId}]: ${promptText}\n`)
    }
  })

  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  rl.on("line", line => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    try {
      const msg = JSON.parse(trimmed) as { type?: string; promptId?: string; runId?: string; answer?: string }
      if (msg.type === "prompt_answered" && typeof msg.promptId === "string" && typeof msg.answer === "string") {
        if (!bus.answer(msg.promptId, msg.answer) && typeof msg.runId === "string") {
          bus.emit({
            type: "prompt_answered",
            runId: msg.runId,
            promptId: msg.promptId,
            answer: msg.answer,
          })
        }
      }
    } catch (parseErr) {
      err.write(`[ndjson] invalid input line (ignored): ${(parseErr as Error).message}\n`)
    }
  })

  return () => {
    unsubscribe()
    rl.close()
  }
}

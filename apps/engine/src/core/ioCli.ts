import * as readline from "node:readline"
import { createBus, busToWorkflowIO, type EventBus } from "./bus.js"
import { withPromptPersistence } from "./promptPersistence.js"
import { attachHumanCliRenderer } from "./renderers/humanCli.js"
import type { WorkflowIO } from "./io.js"
import type { Repos } from "../db/repositories.js"

export type CliIOOptions = {
  /** Replace the default humanCli terminal renderer (e.g. with an NDJSON
   *  renderer for --json mode). */
  renderer?: (bus: EventBus) => () => void
  /** When true, the CLI does not open a readline prompt resolver; some other
   *  subscriber (typically an NDJSON renderer fed by a harness on stdin) is
   *  expected to emit `prompt_answered` on the bus. */
  externalPromptResolver?: boolean
}

/**
 * CLI adapter. Builds an in-process event bus and attaches the terminal
 * renderer. When a human is at the terminal, `readline` resolves
 * `prompt_requested` events by emitting `prompt_answered` back onto the bus —
 * which lets every other subscriber (DB sync, prompt persistence, SSE bridge)
 * see the answer as a first-class event.
 *
 * When `repos` is supplied, `withPromptPersistence` is attached as a
 * subscriber so every `prompt_requested` is mirrored into the shared
 * `pending_prompts` table (making CLI-owned runs visible to the UI). The
 * cross-process answer routing — re-emitting `prompt_answered` that the
 * API wrote into `stage_logs` — is attached by `prepareRun` in the
 * orchestrator, because that's where runId is known.
 */
export function createCliIO(repos?: Repos, opts: CliIOOptions = {}): WorkflowIO & { bus: EventBus } {
  const bus = createBus()

  const detachRenderer = opts.renderer
    ? opts.renderer(bus)
    : attachHumanCliRenderer(bus)

  const detachPersistence = repos ? withPromptPersistence(bus, repos) : () => {}

  const interactivePrompting = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const rl = opts.externalPromptResolver || !interactivePrompting
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout })

  let stdinLineReader: readline.Interface | null = null
  let stdinEnded = false
  const queuedAnswers: string[] = []
  const pendingAnswers: Array<(answer: string) => void> = []

  const detachPromptResolver = opts.externalPromptResolver
    ? () => {}
    : bus.subscribe(event => {
        if (event.type !== "prompt_requested") return

        const resolveAnswer = (answer: string) => {
          bus.emit({
            type: "prompt_answered",
            runId: event.runId,
            promptId: event.promptId,
            answer,
          })
        }

        if (rl) {
          // Interactive TTY. The agent's message text already reached the
          // terminal via `attachHumanCliRenderer`'s `chat_message` line; we
          // just need a short answer cue here. The full prompt text is
          // carried by the bus event (and persisted verbatim by
          // `withPromptPersistence`) so the UI and transcript projection
          // still see meaningful content.
          rl.question("  > ", resolveAnswer)
          return
        }

        // Non-interactive stdin is treated as a queued stream of newline-
        // delimited answers so the CLI can be tested and scripted via pipes.
        if (queuedAnswers.length > 0) {
          resolveAnswer(queuedAnswers.shift() ?? "")
          return
        }
        if (stdinEnded) {
          resolveAnswer("")
          return
        }
        pendingAnswers.push(resolveAnswer)
      })

  if (!opts.externalPromptResolver && !interactivePrompting) {
    stdinLineReader = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    })
    stdinLineReader.on("line", line => {
      const pending = pendingAnswers.shift()
      if (pending) pending(line)
      else queuedAnswers.push(line)
    })
    stdinLineReader.on("close", () => {
      stdinEnded = true
      while (pendingAnswers.length > 0) {
        pendingAnswers.shift()?.("")
      }
    })
  }

  const io = busToWorkflowIO(bus)
  const originalClose = io.close
  return {
    ...io,
    bus,
    close() {
      detachPromptResolver()
      detachRenderer()
      detachPersistence()
      stdinLineReader?.close()
      rl?.close()
      originalClose?.()
    },
  }
}

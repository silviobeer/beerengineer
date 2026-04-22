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

  const rl = opts.externalPromptResolver
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout })

  if (rl) {
    // Subscribe: when a prompt_requested arrives, ask readline and emit the
    // answer back through the bus so every subscriber reacts to it.
    bus.subscribe(event => {
      if (event.type !== "prompt_requested") return
      rl.question(event.prompt, answer => {
        bus.emit({
          type: "prompt_answered",
          runId: event.runId,
          promptId: event.promptId,
          answer,
        })
      })
    })
  }

  const io = busToWorkflowIO(bus)
  const originalClose = io.close
  return {
    ...io,
    bus,
    close() {
      detachRenderer()
      detachPersistence()
      rl?.close()
      originalClose?.()
    },
  }
}

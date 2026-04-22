import * as readline from "readline"
import type { WorkflowEvent, WorkflowIO } from "./io.js"
import { getActiveRun } from "./runContext.js"
import type { Repos } from "../db/repositories.js"

/**
 * CLI adapter. Reads from stdin for prompts, prints events to stdout.
 * Mirrors the previous terminal-only UX.
 *
 * When `repos` is supplied the adapter mirrors each prompt into
 * `pending_prompts` and marks it answered when the terminal returns — this
 * keeps CLI-owned runs visible in the UI run console as read-only state.
 */
export function createCliIO(repos?: Repos): WorkflowIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    async ask(prompt: string): Promise<string> {
      const active = getActiveRun()
      let promptRowId: string | null = null
      if (repos && active) {
        promptRowId = repos.createPendingPrompt({ runId: active.runId, prompt }).id
      }
      const answer = await new Promise<string>(resolve => rl.question(prompt, resolve))
      if (repos && promptRowId) {
        repos.answerPendingPrompt(promptRowId, answer)
      }
      return answer
    },
    emit: (event: WorkflowEvent) => {
      if (event.type === "log") {
        console.log(`  ${event.message}`)
      }
      // other events are derivable from the workflow's own print output; the
      // CLI intentionally stays quiet to avoid double-logging.
    },
    close: () => rl.close()
  }
}

import * as readline from "readline"
import type { WorkflowEvent, WorkflowIO } from "./io.js"

/**
 * CLI adapter. Reads from stdin for prompts, prints events to stdout.
 * Mirrors the previous terminal-only UX.
 */
export function createCliIO(): WorkflowIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask: (prompt: string) => new Promise<string>(resolve => rl.question(prompt, resolve)),
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

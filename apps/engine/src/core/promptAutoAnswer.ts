import { hasEventBus } from "./bus.js"
import type { WorkflowIO } from "./io.js"

function promptSupportsAnswer(actions: { value: string }[] | undefined, answer: string): boolean {
  return actions?.some(action => action.value === answer) === true
}

/**
 * Answer the next matching structured prompt once. Used by item actions such
 * as promote_to_base where the operator has already chosen an action, but the
 * blocked workflow has to recreate the merge-gate prompt during resume.
 */
export function attachOneShotPromptAnswer(io: WorkflowIO, answer: string): () => void {
  if (!hasEventBus(io)) return () => {}

  let detach: (() => void) | null = null
  detach = io.bus.subscribe(event => {
    if (event.type !== "prompt_requested") return
    if (!promptSupportsAnswer(event.actions, answer)) return

    const activeDetach = detach
    detach = null
    activeDetach?.()
    queueMicrotask(() => {
      io.bus.answer(event.promptId, answer)
    })
  })
  return () => {
    const activeDetach = detach
    detach = null
    activeDetach?.()
  }
}

export type WorkflowEvent =
  | { type: "run_started"; runId: string; itemId: string; title: string }
  | { type: "run_finished"; runId: string; status: "completed" | "failed"; error?: string }
  | { type: "stage_started"; runId: string; stageRunId: string; stageKey: string; projectId?: string | null }
  | { type: "stage_completed"; runId: string; stageRunId: string; stageKey: string; status: "completed" | "failed"; error?: string }
  | { type: "prompt_requested"; runId: string; promptId: string; prompt: string; stageRunId?: string | null }
  | { type: "prompt_answered"; runId: string; promptId: string; answer: string }
  | { type: "artifact_written"; runId: string; stageRunId?: string | null; label: string; kind: string; path: string }
  | { type: "log"; runId: string; message: string; level?: "info" | "warn" | "error" }
  | { type: "item_column_changed"; runId: string; itemId: string; column: string; phaseStatus: string }

export type WorkflowIO = {
  /** Ask the operator a question and await a textual answer. */
  ask(prompt: string): Promise<string>
  /** Emit a structured workflow event. */
  emit(event: WorkflowEvent): void
  /** Optional: called on terminal cleanup (e.g. close readline). */
  close?(): void
}

/**
 * The engine keeps a single active WorkflowIO so existing stages can
 * continue to call `ask(prompt)` without threading the io through every
 * function signature. The entrypoint (CLI or API) is responsible for
 * setting the IO before invoking `runWorkflow()` and clearing it after.
 */
let current: WorkflowIO | null = null

export function setWorkflowIO(io: WorkflowIO | null): void {
  current = io
}

export function getWorkflowIO(): WorkflowIO {
  if (!current) {
    throw new Error("WorkflowIO not set — wrap runWorkflow() with setWorkflowIO()")
  }
  return current
}

export function hasWorkflowIO(): boolean {
  return current !== null
}

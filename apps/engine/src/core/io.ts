import { AsyncLocalStorage } from "node:async_hooks"

type WorkflowEventMeta = {
  streamId?: string
  at?: number
}

export type RecoveryEventScope =
  | { type: "run"; runId: string }
  | { type: "stage"; runId: string; stageId: string }
  | { type: "story"; runId: string; waveNumber: number; storyId: string }

export type PresentationKind = "header" | "step" | "ok" | "warn" | "dim" | "finding"

export type WorkflowEvent =
  | ({ type: "run_started"; runId: string; itemId: string; title: string } & WorkflowEventMeta)
  | ({ type: "run_finished"; runId: string; status: "completed" | "failed"; error?: string } & WorkflowEventMeta)
  | ({ type: "stage_started"; runId: string; stageRunId: string; stageKey: string; projectId?: string | null } & WorkflowEventMeta)
  | ({ type: "stage_completed"; runId: string; stageRunId: string; stageKey: string; status: "completed" | "failed"; error?: string } & WorkflowEventMeta)
  | ({ type: "prompt_requested"; runId: string; promptId: string; prompt: string; stageRunId?: string | null } & WorkflowEventMeta)
  | ({ type: "prompt_answered"; runId: string; promptId: string; answer: string } & WorkflowEventMeta)
  | ({ type: "artifact_written"; runId: string; stageRunId?: string | null; label: string; kind: string; path: string } & WorkflowEventMeta)
  | ({ type: "log"; runId: string; message: string; level?: "info" | "warn" | "error" } & WorkflowEventMeta)
  | ({ type: "chat_message"; runId: string; stageRunId?: string | null; role: string; source: "stage-agent" | "reviewer" | "system"; text: string; requiresResponse?: boolean } & WorkflowEventMeta)
  | ({ type: "presentation"; runId?: string; stageRunId?: string | null; kind: PresentationKind; text: string; meta?: { source?: string; severity?: string } } & WorkflowEventMeta)
  | ({ type: "item_column_changed"; runId: string; itemId: string; column: string; phaseStatus: string } & WorkflowEventMeta)
  | ({ type: "project_created"; runId: string; itemId: string; projectId: string; code: string; name: string; summary: string; position: number } & WorkflowEventMeta)
  | ({ type: "run_blocked"; runId: string; scope: RecoveryEventScope; cause: string; summary: string; branch?: string } & WorkflowEventMeta)
  | ({ type: "run_failed"; runId: string; scope: RecoveryEventScope; cause: string; summary: string } & WorkflowEventMeta)
  | ({ type: "external_remediation_recorded"; runId: string; remediationId: string; scope: RecoveryEventScope; summary: string; branch?: string } & WorkflowEventMeta)
  | ({ type: "run_resumed"; runId: string; remediationId: string; scope: RecoveryEventScope } & WorkflowEventMeta)

export type WorkflowIO = {
  /** Ask the operator a question and await a textual answer. */
  ask(prompt: string): Promise<string>
  /** Emit a structured workflow event. */
  emit(event: WorkflowEvent): void
  /** Optional: called on terminal cleanup (e.g. close readline). */
  close?(): void
}

const workflowIOStorage = new AsyncLocalStorage<WorkflowIO>()

export function runWithWorkflowIO<T>(io: WorkflowIO, fn: () => T): T {
  return workflowIOStorage.run(io, fn)
}

export function getWorkflowIO(): WorkflowIO {
  const io = workflowIOStorage.getStore()
  if (!io) {
    throw new Error("WorkflowIO not set — wrap the workflow with runWithWorkflowIO()")
  }
  return io
}

export function hasWorkflowIO(): boolean {
  return workflowIOStorage.getStore() !== undefined
}

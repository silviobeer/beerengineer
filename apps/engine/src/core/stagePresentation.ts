import { emitEvent, getActiveRun } from "./runContext.js"
import type { PresentationKind } from "./io.js"

/**
 * Internal: emit a presentation event only when a run context is active.
 * Before runs start (e.g. the CLI's intake banner) there is no run to
 * attach the event to, and persisting it would violate `stage_logs`'
 * `run_id NOT NULL` invariant. Swallowing the emit is the correct move —
 * terminal-only intake output is produced through the CLI adapter directly.
 */
function emit(kind: PresentationKind, text: string, meta?: { source?: string; severity?: string }): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "presentation",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    kind,
    text,
    meta,
  })
}

function emitChat(role: string, text: string, source: "stage-agent" | "reviewer" | "system" = "system"): void {
  const active = getActiveRun()
  if (!active) return
  emitEvent({
    type: "chat_message",
    runId: active.runId,
    stageRunId: active.stageRunId ?? null,
    role,
    source,
    text,
  })
}

/**
 * The canonical vocabulary for stage-side UX. Stages import these instead of
 * `print.ts`; every call becomes a bus event and is rendered by whichever
 * transport the run was launched with (humanCli, NDJSON, SSE, …) and
 * persisted into `stage_logs` by `attachDbSync`.
 */
export const stagePresent = {
  header(text: string)                        { emit("header", text) },
  step(text: string)                          { emit("step", text) },
  ok(text: string)                            { emit("ok", text) },
  warn(text: string)                          { emit("warn", text) },
  dim(text: string)                           { emit("dim", text) },
  finding(source: string, severity: string, text: string) {
    emit("finding", text, { source, severity })
  },
  /** Emit a chat-style message (LLM output, reviewer feedback, etc.). */
  chat(role: string, text: string, source: "stage-agent" | "reviewer" | "system" = "system") {
    emitChat(role, text, source)
  },
}

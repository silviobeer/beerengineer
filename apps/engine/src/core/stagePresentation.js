import { emitEvent, getActiveRun } from "./runContext.js";
/**
 * Internal: emit a presentation event only when a run context is active.
 * Before runs start (e.g. the CLI's intake banner) there is no run to
 * attach the event to, and persisting it would violate `stage_logs`'
 * `run_id NOT NULL` invariant. Swallowing the emit is the correct move —
 * terminal-only intake output is produced through the CLI adapter directly.
 */
function emit(kind, text, meta) {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "presentation",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        kind,
        text,
        meta,
    });
}
function emitChat(role, text, source = "system") {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "chat_message",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        role,
        source,
        text,
    });
}
/**
 * The canonical vocabulary for stage-side UX. Stages import these instead of
 * `print.ts`; every call becomes a bus event and is rendered by whichever
 * transport the run was launched with (humanCli, NDJSON, SSE, …) and
 * persisted into `stage_logs` by `attachDbSync`.
 */
export const stagePresent = {
    header(text) { emit("header", text); },
    step(text) { emit("step", text); },
    ok(text) { emit("ok", text); },
    warn(text) { emit("warn", text); },
    dim(text) { emit("dim", text); },
    finding(source, severity, text) {
        emit("finding", text, { source, severity });
    },
    /** Emit a chat-style message (LLM output, reviewer feedback, etc.). */
    chat(role, text, source = "system") {
        emitChat(role, text, source);
    },
};

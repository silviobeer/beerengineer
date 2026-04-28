import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getWorkflowIO, hasWorkflowIO } from "./io.js";
const runContextStorage = new AsyncLocalStorage();
export function runWithActiveRun(ctx, fn) {
    return runContextStorage.run(ctx, fn);
}
export function getActiveRun() {
    return runContextStorage.getStore() ?? null;
}
export function emitEvent(event) {
    if (!hasWorkflowIO())
        return;
    getWorkflowIO().emit(event);
}
/**
 * Wrap a stage invocation with start/completed lifecycle events.
 * Safe to use without an active IO (becomes a no-op wrapper).
 */
export async function withStageLifecycle(stageKey, fn, opts = {}) {
    const current = getActiveRun();
    if (!current || !hasWorkflowIO()) {
        return fn();
    }
    const stageRunId = randomUUID();
    return runWithActiveRun({ ...current, stageRunId }, async () => {
        emitEvent({ type: "stage_started", runId: current.runId, stageRunId, stageKey, projectId: opts.projectId ?? null });
        try {
            const result = await fn();
            emitEvent({ type: "stage_completed", runId: current.runId, stageRunId, stageKey, status: "completed" });
            return result;
        }
        catch (err) {
            emitEvent({
                type: "stage_completed",
                runId: current.runId,
                stageRunId,
                stageKey,
                status: "failed",
                error: err.message
            });
            throw err;
        }
    });
}

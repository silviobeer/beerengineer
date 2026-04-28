import { LOG_TAIL_INTERVAL_MS } from "./constants.js";
/**
 * Bridge foreign writes on the shared `stage_logs` log back into the local
 * bus. This is how a CLI-owned run learns that the UI/API answered its
 * pending prompt: the API writes a `prompt_answered` row; the bridge picks
 * it up and re-emits the event on the local bus; `bus.emit` resolves the
 * pending `bus.request()` promise.
 *
 * `writtenLogIds` is the set of row ids the local process wrote (populated
 * by `attachDbSync`). The bridge filters those out so we don't re-emit our
 * own writes and cause a loop.
 *
 * Only a small, curated subset of event types is re-emitted — anything the
 * local process would already have emitted itself (e.g. `stage_started`
 * from the very stage the local orchestrator is running) has no business
 * being re-injected locally.
 */
export function attachCrossProcessBridge(bus, repos, runId, opts) {
    // Start the cursor at "now" so we don't re-emit historical events from a
    // past run lifecycle — only foreign writes that arrive *after* this bridge
    // attached should surface on the local bus.
    let cursor = Date.now();
    const interval = opts.intervalMs ?? LOG_TAIL_INTERVAL_MS;
    const timer = setInterval(() => {
        const rows = repos.listLogsForRun(runId, cursor);
        for (const row of rows) {
            cursor = Math.max(cursor, row.created_at + 1);
            if (opts.writtenLogIds.has(row.id))
                continue;
            const event = rehydrate(row);
            if (event)
                bus.emit(event);
        }
    }, interval);
    // Deliberately **not** `unref()`-ing: the bridge holds the CLI's event
    // loop alive while an `ask()` is awaiting a cross-process answer. The
    // returned detach function is the only correct way to tear it down
    // (called by `prepareRun`'s `finally` block).
    return () => clearInterval(timer);
}
function parseJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Minimal reverse-mapping from a persisted log row back to a `WorkflowEvent`.
 * Only the event types the bridge needs to deliver across processes are
 * listed — extending the set is safe but should be driven by an actual
 * cross-process need, not speculation.
 */
function rehydrate(row) {
    if (row.event_type !== "prompt_answered")
        return null;
    const data = parseJson(row.data_json);
    const promptId = typeof data?.promptId === "string" ? data.promptId : undefined;
    if (!promptId)
        return null;
    return {
        type: "prompt_answered",
        runId: row.run_id,
        promptId,
        answer: row.message,
        source: "bridge",
    };
}

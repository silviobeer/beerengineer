import { LOG_TAIL_INTERVAL_MS } from "../../core/constants.js";
/**
 * Poll `stage_logs` at a fixed interval, delivering each new row to `onRow`.
 * The cursor is advanced so each row is only delivered once per subscriber.
 *
 * Returns a `stop()` function that clears the interval. Callers that want a
 * single initial replay should call `pollOnce()` via the returned handle.
 */
export function tailStageLogs(repos, opts, onRow) {
    const runId = opts.scope.kind === "run" ? opts.scope.runId : undefined;
    const initialCursor = opts.sinceId
        ? repos.getStageLogCursorById(opts.sinceId, runId)?.log_rowid ?? 0
        : 0;
    let cursor = initialCursor;
    let stopped = false;
    const pollOnce = () => {
        if (stopped)
            return;
        const rows = opts.scope.kind === "run"
            ? repos.listLogsForRunAfterCursor(opts.scope.runId, cursor)
            : repos.listLogsForWorkspaceAfterCursor(opts.scope.workspaceId, cursor);
        for (const row of rows) {
            cursor = row.log_rowid;
            onRow(row);
        }
    };
    const timer = setInterval(pollOnce, opts.intervalMs ?? LOG_TAIL_INTERVAL_MS);
    return {
        stop() {
            stopped = true;
            clearInterval(timer);
        },
        pollOnce,
    };
}

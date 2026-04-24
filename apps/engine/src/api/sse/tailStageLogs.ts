import type { Repos, StageLogCursorRow } from "../../db/repositories.js"
import { LOG_TAIL_INTERVAL_MS } from "../../core/constants.js"

export type TailScope =
  | { kind: "run"; runId: string }
  | { kind: "workspace"; workspaceId: string | null }

export type TailOptions = {
  scope: TailScope
  intervalMs?: number
  /** Read starting after this stable stage_logs id. */
  sinceId?: string | null
}

/** Workspace-scoped rows carry `item_id` from the join in repositories. */
export type TailRow = StageLogCursorRow

/**
 * Poll `stage_logs` at a fixed interval, delivering each new row to `onRow`.
 * The cursor is advanced so each row is only delivered once per subscriber.
 *
 * Returns a `stop()` function that clears the interval. Callers that want a
 * single initial replay should call `pollOnce()` via the returned handle.
 */
export function tailStageLogs(
  repos: Repos,
  opts: TailOptions,
  onRow: (row: TailRow) => void,
): { stop(): void; pollOnce(): void } {
  let cursor =
    opts.sinceId
      ? (repos.getStageLogCursorById(opts.sinceId, opts.scope.kind === "run" ? opts.scope.runId : undefined)?.log_rowid ?? 0)
      : 0
  let stopped = false

  const pollOnce = (): void => {
    if (stopped) return
    const rows =
      opts.scope.kind === "run"
        ? repos.listLogsForRunAfterCursor(opts.scope.runId, cursor)
        : repos.listLogsForWorkspaceAfterCursor(opts.scope.workspaceId, cursor)
    for (const row of rows) {
      cursor = row.log_rowid
      onRow(row)
    }
  }

  const timer = setInterval(pollOnce, opts.intervalMs ?? LOG_TAIL_INTERVAL_MS)

  return {
    stop(): void {
      stopped = true
      clearInterval(timer)
    },
    pollOnce,
  }
}

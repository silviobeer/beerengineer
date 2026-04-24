import type { Repos, StageLogRow } from "../../db/repositories.js"
import { LOG_TAIL_INTERVAL_MS } from "../../core/constants.js"

export type TailScope =
  | { kind: "run"; runId: string }
  | { kind: "workspace"; workspaceId: string | null }

export type TailOptions = {
  scope: TailScope
  intervalMs?: number
  /** Read starting at this unix-ms cursor. Default 0 = full history. */
  startCursor?: number
}

/** Workspace-scoped rows carry `item_id` from the join in repositories. */
export type TailRow = StageLogRow & { item_id?: string }

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
  let cursor = opts.startCursor ?? 0
  let stopped = false

  const pollOnce = (): void => {
    if (stopped) return
    const rows =
      opts.scope.kind === "run"
        ? repos.listLogsForRun(opts.scope.runId, cursor)
        : repos.listLogsForWorkspace(opts.scope.workspaceId, cursor)
    for (const row of rows) {
      cursor = Math.max(cursor, row.created_at + 1)
      onRow(row)
    }
  }

  const timer = setInterval(pollOnce, opts.intervalMs ?? LOG_TAIL_INTERVAL_MS)
  timer.unref?.()

  return {
    stop(): void {
      stopped = true
      clearInterval(timer)
    },
    pollOnce,
  }
}

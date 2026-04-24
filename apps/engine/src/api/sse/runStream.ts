import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../db/repositories.js"
import { parseLogData, writeSse } from "../http.js"
import { tailStageLogs } from "./tailStageLogs.js"

/**
 * SSE stream for a single run. Delivers every `stage_logs` row written for
 * the given runId, then polls for new rows until the run finishes.
 */
export function handleRunEvents(repos: Repos, req: IncomingMessage, res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ runId, at: Date.now() })}\n\n`)

  let closed = false
  const seenStreamIds = new Set<string>()

  const close = (): void => {
    if (closed) return
    closed = true
    tail.stop()
    res.end()
  }

  const tail = tailStageLogs(repos, { scope: { kind: "run", runId } }, row => {
    if (closed || seenStreamIds.has(row.id)) return
    seenStreamIds.add(row.id)
    writeSse(res, row.event_type, {
      streamId: row.id,
      at: row.created_at,
      message: row.message,
      stageRunId: row.stage_run_id,
      data: parseLogData(row.data_json),
    })
    if (row.event_type === "run_finished") close()
  })

  // Initial replay of everything already in the log.
  tail.pollOnce()

  // Edge case: a run that ended without ever writing a `run_finished` log
  // (interrupted / legacy). Close the stream when the DB shows the run as
  // no longer running and the cursor has caught up.
  const watchdog = setInterval(() => {
    if (closed) return
    const run = repos.getRun(runId)
    if (!run || run.status === "running") return
    const hasFinishedLog = repos.listLogsForRun(runId, 0).some(row => row.event_type === "run_finished")
    if (!hasFinishedLog) close()
  }, 1_000)
  watchdog.unref?.()

  req.on("close", () => {
    closed = true
    tail.stop()
    clearInterval(watchdog)
  })
}

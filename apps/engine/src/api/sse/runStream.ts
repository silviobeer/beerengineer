import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../db/repositories.js"
import { writeSse } from "../http.js"
import { messagingLevelFromQuery, shouldDeliverAtLevel } from "../../core/messagingLevel.js"
import { projectStageLogRow } from "../../core/messagingProjection.js"
import { tailStageLogs } from "./tailStageLogs.js"

/**
 * SSE stream for a single run. Delivers every `stage_logs` row written for
 * the given runId, then polls for new rows until the run finishes.
 */
export function handleRunEvents(repos: Repos, req: IncomingMessage, res: ServerResponse, runId: string): void {
  const url = new URL(req.url ?? `/runs/${runId}/events`, "http://127.0.0.1")
  const subscribedLevel = messagingLevelFromQuery(url.searchParams.get("level"), 2)
  const sinceId = url.searchParams.get("since")
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

  const tail = tailStageLogs(repos, { scope: { kind: "run", runId }, sinceId }, row => {
    if (closed || seenStreamIds.has(row.id)) return
    const entry = projectStageLogRow(row)
    if (!entry || !shouldDeliverAtLevel(entry, subscribedLevel)) {
      if (row.event_type === "run_finished" || row.event_type === "run_failed" || row.event_type === "run_blocked") close()
      return
    }
    seenStreamIds.add(row.id)
    writeSse(res, entry.type, entry)
    if (entry.type === "run_finished" || entry.type === "run_failed" || entry.type === "run_blocked") close()
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

  res.on("close", () => {
    closed = true
    tail.stop()
    clearInterval(watchdog)
  })
}

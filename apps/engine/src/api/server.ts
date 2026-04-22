import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { initDatabase } from "../db/connection.js"
import { Repos, type ItemRow } from "../db/repositories.js"
import { getBoard, getRunTree } from "./board.js"
import { type WorkflowEvent } from "../core/io.js"
import { createApiIOSession } from "../core/ioApi.js"
import { prepareRun } from "../core/runOrchestrator.js"
import { createItemActionsService, isItemAction, type ItemActionEvent } from "../core/itemActions.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"

const db = initDatabase()
const repos = new Repos(db)

type SessionEntry = ReturnType<typeof createApiIOSession>
const sessions = new Map<string, SessionEntry>()

const sessionItemIds = new Map<string, string>() // runId -> itemId
function trackSessionItem(runId: string, itemId: string): void {
  sessionItemIds.set(runId, itemId)
}

const itemActions = createItemActionsService(repos, {
  onSessionStart: ({ session, runId, itemId }) => {
    trackSessionItem(runId, itemId)
    subscribeSessionToBoardStream(session, itemId)
  }
})
// Item-action-started runs get their IO session stored on the service; merge
// that view with the one `POST /runs` uses so SSE and prompt input keep working
// regardless of which surface started the run.
function resolveSession(runId: string): SessionEntry | undefined {
  return sessions.get(runId) ?? itemActions.sessions.get(runId)
}

function resolveItemIdForRun(runId: string): string | undefined {
  return sessionItemIds.get(runId) ?? repos.getRun(runId)?.item_id
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS")
  res.setHeader("access-control-allow-headers", "content-type")
}

async function handleItemAction(
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string
): Promise<void> {
  const body = (await readJson(req)) as { action?: unknown }
  if (!isItemAction(body.action)) {
    return json(res, 400, { error: "action is required", valid: ["start_brainstorm", "promote_to_requirements", "start_implementation", "resume_run", "mark_done"] })
  }

  const result = await itemActions.perform(itemId, body.action)
  if (!result.ok) {
    if (result.status === 404) return json(res, 404, { error: result.error })
    return json(res, 409, {
      error: result.error,
      current: result.current,
      action: result.action
    })
  }
  const payload: Record<string, unknown> = {
    itemId: result.itemId,
    column: result.column,
    phaseStatus: result.phaseStatus
  }
  if (result.runId) payload.runId = result.runId
  json(res, 200, payload)
}

const boardEventsEmitter = (() => {
  // Re-broadcast item-action service events as the shape defined in the
  // plan's event schema. The orchestrator-driven events (run_started,
  // stage_started, …) are emitted through the run sessions; `/events`
  // subscribes to both the itemActions emitter and every active session.
  return itemActions
})()

type BoardSseClient = { res: ServerResponse; id: string; workspaceId: string | null }
const boardSseClients = new Set<BoardSseClient>()

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function resolveBoardEventWorkspaceId(data: unknown): string | null {
  const payload = data as { itemId?: string; runId?: string } | null
  if (payload?.itemId) return repos.getItem(payload.itemId)?.workspace_id ?? null
  if (payload?.runId) return repos.getRun(payload.runId)?.workspace_id ?? null
  return null
}

function broadcastBoardEvent(event: string, data: unknown): void {
  const workspaceId = resolveBoardEventWorkspaceId(data)
  for (const client of boardSseClients) {
    if (client.workspaceId && workspaceId && client.workspaceId !== workspaceId) {
      continue
    }
    try {
      writeSse(client.res, event, data)
    } catch {
      boardSseClients.delete(client)
    }
  }
}

boardEventsEmitter.on("event", (ev: ItemActionEvent) => {
  broadcastBoardEvent(ev.type, ev)
})

// Orchestrator events flow through sessions. Subscribe to every session we
// create so run/stage events also appear on the board stream.
function subscribeSessionToBoardStream(session: SessionEntry, itemId: string): void {
  session.emitter.on("event", (ev: WorkflowEvent) => {
    switch (ev.type) {
      case "run_started":
        broadcastBoardEvent("run_started", { runId: ev.runId, itemId: ev.itemId, startedAt: ev.at ?? Date.now() })
        break
      case "stage_started":
        broadcastBoardEvent("stage_started", { runId: ev.runId, itemId, stage: ev.stageKey })
        break
      case "stage_completed":
        broadcastBoardEvent("stage_completed", { runId: ev.runId, itemId, stage: ev.stageKey, status: ev.status })
        break
      case "run_finished":
        broadcastBoardEvent("run_finished", { runId: ev.runId, itemId, status: ev.status })
        break
      case "project_created":
        broadcastBoardEvent("project_created", { itemId: ev.itemId, projectRef: ev.projectId })
        break
    }
  })
}

async function handleStartRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { title?: string; description?: string; workspaceKey?: string }
  if (!body.title) return json(res, 400, { error: "title is required" })

  const session = createApiIOSession(repos)
  const prepared = prepareRun(
    { id: "new", title: body.title, description: body.description ?? "" },
    repos,
    session.io,
    { workspaceKey: body.workspaceKey }
  )
  sessions.set(prepared.runId, session)
  trackSessionItem(prepared.runId, prepared.itemId)
  subscribeSessionToBoardStream(session, prepared.itemId)

  prepared
    .start()
    .catch(err => console.error("[workflow]", err))
    .finally(() => {
      // keep session briefly so late SSE clients still get final events
      setTimeout(() => {
        session.dispose()
        sessions.delete(prepared.runId)
      }, 30_000)
    })

  json(res, 202, { runId: prepared.runId })
}

function handleGetBoard(url: URL, res: ServerResponse): void {
  const workspaceKey = url.searchParams.get("workspace")
  const board = getBoard(db, workspaceKey)
  json(res, 200, board)
}

function handleGetRun(res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found" })
  json(res, 200, run)
}

function handleGetRunTree(res: ServerResponse, runId: string): void {
  const tree = getRunTree(repos, runId)
  if (!tree) return json(res, 404, { error: "run not found" })
  json(res, 200, tree)
}

function handleListRuns(res: ServerResponse): void {
  json(res, 200, { runs: repos.listRuns() })
}

async function handleRunInput(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  const body = (await readJson(req)) as { answer?: string; promptId?: string }
  if (!body.answer) return json(res, 400, { error: "answer is required" })

  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found" })
  if (run.owner === "cli") {
    return json(res, 409, { error: "cli_owned", detail: "CLI-owned runs answer prompts via the terminal" })
  }

  const session = resolveSession(runId)
  if (!session) return json(res, 404, { error: "no active session" })

  const promptId = body.promptId ?? repos.getOpenPrompt(runId)?.id
  if (!promptId) return json(res, 404, { error: "no open prompt" })

  const ok = session.answerPrompt(promptId, body.answer)
  if (!ok) return json(res, 404, { error: "prompt not pending" })

  json(res, 200, { runId, promptId, answer: body.answer })
}

function handleBoardEvents(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/events", `http://${HOST}:${PORT}`)
  const workspaceKey = url.searchParams.get("workspace")
  const workspaceId = workspaceKey
    ? (db.prepare("SELECT id FROM workspaces WHERE key = ?").get(workspaceKey) as { id: string } | undefined)?.id ?? "__missing__"
    : null

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now(), workspace: workspaceKey })}\n\n`)

  const client: BoardSseClient = { res, id: Math.random().toString(36).slice(2), workspaceId }
  boardSseClients.add(client)

  const keepAlive = setInterval(() => {
    try {
      res.write(":keepalive\n\n")
    } catch {
      clearInterval(keepAlive)
      boardSseClients.delete(client)
    }
  }, 25_000)

  req.on("close", () => {
    clearInterval(keepAlive)
    boardSseClients.delete(client)
  })
}

function handleEvents(req: IncomingMessage, res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ runId, at: Date.now() })}\n\n`)

  const seenStreamIds = new Set<string>()
  const replayPersistedLogs = () => {
    for (const log of repos.listLogsForRun(runId)) {
      seenStreamIds.add(log.id)
      res.write(
        `event: ${log.event_type}\ndata: ${JSON.stringify({
          streamId: log.id,
          at: log.created_at,
          message: log.message,
          stageRunId: log.stage_run_id,
          data: log.data_json ? JSON.parse(log.data_json) : undefined
        })}\n\n`
      )
    }
  }

  const session = resolveSession(runId)
  if (session) {
    const pending: WorkflowEvent[] = []
    let replayComplete = false

    const writeEvent = (event: WorkflowEvent) => {
      if (event.streamId) {
        if (seenStreamIds.has(event.streamId)) return
        seenStreamIds.add(event.streamId)
      }
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      if (event.type === "run_finished") {
        res.end()
      }
    }

    const listener = (event: WorkflowEvent) => {
      if (!replayComplete) {
        pending.push(event)
        return
      }
      writeEvent(event)
    }
    session.emitter.on("event", listener)

    // Subscribe first, then replay and flush buffered live events. The stream
    // may briefly buffer duplicates, but streamId dedup keeps the sequence
    // complete across the replay/live handoff.
    replayPersistedLogs()
    replayComplete = true
    pending.forEach(writeEvent)

    req.on("close", () => {
      session.emitter.off("event", listener)
    })
  } else {
    // No active session — replay persisted history for completed/cleaned-up runs
    // and then close the stream.
    replayPersistedLogs()
    res.end()
  }
}

/**
 * Optional dev convenience: when BEERENGINEER_SEED=1 (default for local dev)
 * insert a demo workspace + cards so a fresh DB renders something. Tests must
 * leave this off (or pass BEERENGINEER_SEED=0) so they get a clean slate.
 */
function seedIfEmpty(): void {
  if (process.env.BEERENGINEER_SEED === "0") return
  if (!process.env.BEERENGINEER_SEED && process.env.NODE_ENV === "test") return
  const count = (db.prepare("SELECT COUNT(*) as c FROM workspaces").get() as { c: number }).c
  if (count > 0) return
  const ws = repos.upsertWorkspace({
    key: "alpha",
    name: "Alpha Workspace",
    description: "Primary delivery scope"
  })
  const samples: Array<{ title: string; description: string; column: ItemRow["current_column"]; phase: ItemRow["phase_status"] }> = [
    { title: "Live board shell integration", description: "Server-side board view backed by real workspace items.", column: "idea", phase: "draft" },
    { title: "Engine event stream", description: "SSE pipe from workflow engine to board UI.", column: "brainstorm", phase: "running" },
    { title: "Prompt handoff wiring", description: "Allow the UI to answer engine prompts without the CLI.", column: "implementation", phase: "running" },
    { title: "Welcome tour", description: "Guided overlay for first-time operators.", column: "done", phase: "completed" }
  ]
  for (const s of samples) {
    const it = repos.createItem({ workspaceId: ws.id, title: s.title, description: s.description })
    repos.setItemColumn(it.id, s.column, s.phase)
  }
}

seedIfEmpty()

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) return json(res, 400, { error: "bad request" })
  setCors(res)
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = url.pathname

  try {
    // POST /runs
    if (path === "/runs" && req.method === "POST") return handleStartRun(req, res)
    // GET /runs
    if (path === "/runs" && req.method === "GET") return handleListRuns(res)
    // GET /board
    if (path === "/board" && req.method === "GET") return handleGetBoard(url, res)
    // GET /events — workspace-scoped board SSE stream
    if (path === "/events" && req.method === "GET") return handleBoardEvents(req, res)

    // POST /items/:id/actions
    const itemMatch = path.match(/^\/items\/([^/]+)\/actions$/)
    if (itemMatch && req.method === "POST") return handleItemAction(req, res, itemMatch[1])

    // /runs/:id + /runs/:id/input + /runs/:id/tree + /runs/:id/events + /runs/:id/prompts
    const runMatch = path.match(/^\/runs\/([^/]+)(?:\/(input|tree|events|prompts))?$/)
    if (runMatch) {
      const [, runId, sub] = runMatch
      if (!sub && req.method === "GET") return handleGetRun(res, runId)
      if (sub === "tree" && req.method === "GET") return handleGetRunTree(res, runId)
      if (sub === "events" && req.method === "GET") return handleEvents(req, res, runId)
      if (sub === "input" && req.method === "POST") return handleRunInput(req, res, runId)
      if (sub === "prompts" && req.method === "GET") {
        const open = repos.getOpenPrompt(runId)
        return json(res, 200, { prompt: open ?? null })
      }
    }

    // /health
    if (path === "/health") return json(res, 200, { ok: true })

    json(res, 404, { error: "not found" })
  } catch (err) {
    console.error("[api]", err)
    json(res, 500, { error: (err as Error).message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`beerengineer2 engine listening on http://${HOST}:${PORT}`)
})

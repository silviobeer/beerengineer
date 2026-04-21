import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { initDatabase } from "../db/connection.js"
import { Repos, type ItemRow } from "../db/repositories.js"
import { getBoard, getRunTree } from "./board.js"
import { setWorkflowIO, type WorkflowEvent } from "../core/io.js"
import { createApiIOSession } from "../core/ioApi.js"
import { prepareRun } from "../core/runOrchestrator.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"

const db = initDatabase()
const repos = new Repos(db)

type SessionEntry = ReturnType<typeof createApiIOSession>
const sessions = new Map<string, SessionEntry>()

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

async function handleStartRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { title?: string; description?: string; workspaceKey?: string }
  if (!body.title) return json(res, 400, { error: "title is required" })

  // One active workflow at a time (global IO). Reject only if a run is
  // actually still executing — completed/failed sessions may still linger in
  // the cleanup window but should not block a new start.
  for (const [, s] of sessions) {
    const run = repos.getRun(s.runId)
    if (run && run.status === "running") {
      return json(res, 409, { error: "a workflow is already running" })
    }
  }

  // Build the session without a runId, then bind it after prepareRun() assigns one.
  const session = createApiIOSession("__pending__", repos)
  setWorkflowIO(session.io)

  const prepared = prepareRun(
    { id: "new", title: body.title, description: body.description ?? "" },
    repos,
    { workspaceKey: body.workspaceKey }
  )
  session.setRunId(prepared.runId)
  sessions.set(prepared.runId, session)

  // Kick off workflow in the background — response returns immediately with runId.
  prepared
    .start()
    .catch(err => console.error("[workflow]", err))
    .finally(() => {
      setWorkflowIO(null)
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

  const session = sessions.get(runId)
  if (!session) return json(res, 404, { error: "no active session" })

  const promptId = body.promptId ?? repos.getOpenPrompt(runId)?.id
  if (!promptId) return json(res, 404, { error: "no open prompt" })

  const ok = session.answerPrompt(promptId, body.answer)
  if (!ok) return json(res, 404, { error: "prompt not pending" })

  json(res, 200, { runId, promptId, answer: body.answer })
}

function handleEvents(req: IncomingMessage, res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ runId, at: Date.now() })}\n\n`)

  // replay persisted logs so the client sees history
  for (const log of repos.listLogsForRun(runId)) {
    res.write(
      `event: ${log.event_type}\ndata: ${JSON.stringify({
        id: log.id,
        at: log.created_at,
        message: log.message,
        stageRunId: log.stage_run_id,
        data: log.data_json ? JSON.parse(log.data_json) : undefined
      })}\n\n`
    )
  }

  const session = sessions.get(runId)
  if (session) {
    const listener = (event: WorkflowEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      if (event.type === "run_finished") {
        res.end()
      }
    }
    session.emitter.on("event", listener)
    req.on("close", () => {
      session.emitter.off("event", listener)
    })
  } else {
    // no active session — run must be finished; close stream after replay.
    res.end()
  }
}

// Simple seed on first boot so an empty DB still shows UI content.
function seedIfEmpty(): void {
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

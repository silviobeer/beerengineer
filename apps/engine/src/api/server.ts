import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { randomBytes } from "node:crypto"
import {
  backfillWorkspaceConfigs,
  getRegisteredWorkspace,
  listRegisteredWorkspaces,
  openWorkspace,
  previewWorkspace,
  registerWorkspace,
  removeWorkspace,
} from "../core/workspaces.js"
import { initDatabase } from "../db/connection.js"
import { Repos, type ItemRow, type StageLogRow } from "../db/repositories.js"
import { getBoard, getRunTree } from "./board.js"
import { createApiIOSession } from "../core/ioApi.js"
import { prepareRun } from "../core/runOrchestrator.js"
import { createItemActionsService, isItemAction, type ItemActionEvent } from "../core/itemActions.js"
import { isResumeInFlight, loadResumeReadiness, performResume } from "../core/resume.js"
import { LOG_TAIL_INTERVAL_MS } from "../core/constants.js"
import { generateSetupReport } from "../setup/doctor.js"
import {
  KNOWN_GROUP_IDS,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
  validateHarnessProfileShape,
} from "../setup/config.js"
import type { AppConfig, SetupReport } from "../setup/types.js"
import type { HarnessProfile, RegisterWorkspaceInput } from "../types/workspace.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"

// CSRF token: the local engine binds to 127.0.0.1 with permissive CORS so the
// paired UI on a different port can talk to it. Without a token, any browser
// tab a user visits could issue mutating requests (POST /workspaces, DELETE
// /workspaces/:key?purge=1, …) from its own origin. We require this token on
// all mutating methods. The token is printed once to stderr on startup and
// read by the UI via BEERENGINEER_API_TOKEN.
const API_TOKEN = process.env.BEERENGINEER_API_TOKEN ?? randomBytes(24).toString("hex")
const API_TOKEN_WAS_PROVIDED = Boolean(process.env.BEERENGINEER_API_TOKEN)
const ALLOWED_ORIGIN = process.env.BEERENGINEER_UI_ORIGIN ?? "http://127.0.0.1:3100"

const db = initDatabase()
const repos = new Repos(db)

type SessionEntry = ReturnType<typeof createApiIOSession>
const sessions = new Map<string, SessionEntry>()

const itemActions = createItemActionsService(repos, {
  onSessionStart: ({ session, runId }) => {
    sessions.set(runId, session)
  }
})

// Merge the two origin maps so callers don't care which surface started the
// run.
function resolveSession(runId: string): SessionEntry | undefined {
  return sessions.get(runId) ?? itemActions.sessions.get(runId)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function loadEffectiveConfig(): AppConfig | null {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  const state = readConfigFile(configPath)
  return resolveMergedConfig(state, overrides) as AppConfig | null
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

function setCors(res: ServerResponse, req: IncomingMessage): void {
  // Echo only the approved UI origin. `*` combined with a DELETE route that
  // does rm -rf would let any page on the user's browser delete workspaces.
  const origin = req.headers.origin
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("access-control-allow-origin", origin)
    res.setHeader("vary", "origin")
    res.setHeader("access-control-allow-credentials", "true")
  }
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
  res.setHeader("access-control-allow-headers", "content-type, x-beerengineer-token")
}

const MUTATING_METHODS = new Set(["POST", "DELETE", "PUT", "PATCH"])

function requireCsrfToken(req: IncomingMessage): boolean {
  if (!MUTATING_METHODS.has(req.method ?? "")) return true
  const header = req.headers["x-beerengineer-token"]
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === "string" && value === API_TOKEN
}

function parseLogData(dataJson: string | null): unknown {
  if (!dataJson) return undefined
  try {
    return JSON.parse(dataJson)
  } catch {
    return undefined
  }
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function handleItemAction(
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string
): Promise<void> {
  const body = (await readJson(req)) as {
    action?: unknown
    resume?: { summary?: string; branch?: string; commitSha?: string; reviewNotes?: string }
  }
  if (!isItemAction(body.action)) {
    return json(res, 400, { error: "action is required", valid: ["start_brainstorm", "promote_to_requirements", "start_implementation", "resume_run", "mark_done"] })
  }

  const resumeInput = body.resume?.summary
    ? { resume: body.resume as { summary: string; branch?: string; commitSha?: string; reviewNotes?: string } }
    : undefined
  const result = await itemActions.perform(itemId, body.action, resumeInput)
  if (!result.ok) {
    if (result.status === 404) return json(res, 404, { error: result.error })
    if (result.status === 422) return json(res, 422, { error: result.error, action: result.action })
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
  if (result.remediationId) payload.remediationId = result.remediationId
  json(res, 200, payload)
}

// ---------------------------------------------------------------------------
// Board stream (/events) — single delivery model: tail stage_logs
// ---------------------------------------------------------------------------
//
// The board stream rebroadcasts a small set of run lifecycle + project events
// to any UI tab listening on `/events[?workspace=<key>]`. All of them land
// in `stage_logs` when the run's dbSync subscriber persists them, so we poll
// `stage_logs` as the shared bus and fan out to SSE clients. `item_column_
// changed` is a pure item-level event that doesn't touch `stage_logs`, so
// the `itemActions` service (which emits it) is the only origin for that
// event — keeping the two origins **non-overlapping** and dedup-free by
// construction.

type BoardSseClient = { res: ServerResponse; id: string; workspaceId: string | null }
const boardSseClients = new Set<BoardSseClient>()

const boardRelevantLogEvents = new Set([
  "run_started",
  "stage_started",
  "stage_completed",
  "run_finished",
  "project_created",
])

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

// `boardLogCursor` is a module-level high-water mark for the workspace log
// tail. On server restart it resets to 0 and replays all historical
// lifecycle logs to every connecting client — acceptable for now (SSE
// clients filter on `streamId` to dedup), but worth revisiting if the log
// grows unbounded.
let boardLogCursor = 0
let boardLogPollerStarted = false

function ensureBoardLogPoller(): void {
  if (boardLogPollerStarted) return
  boardLogPollerStarted = true
  setInterval(() => {
    const logs = repos.listLogsForWorkspace(null, boardLogCursor)
    for (const log of logs) {
      boardLogCursor = Math.max(boardLogCursor, log.created_at + 1)
      if (!boardRelevantLogEvents.has(log.event_type)) continue
      broadcastBoardEvent(log.event_type, {
        runId: log.run_id,
        itemId: log.item_id,
        streamId: log.id,
        at: log.created_at,
        message: log.message,
        stageRunId: log.stage_run_id,
        data: parseLogData(log.data_json),
      })
    }
  }, LOG_TAIL_INTERVAL_MS).unref?.()
}

// `itemActions` emits `item_column_changed` and a couple of other
// service-level events. Lifecycle events (run_started, stage_started, …)
// are **intentionally ignored** here because the log poller already covers
// them — having two origins was the deduplication bug before this refactor.
itemActions.on("event", (ev: ItemActionEvent) => {
  if (ev.type === "item_column_changed") {
    broadcastBoardEvent("item_column_changed", ev)
  }
})
ensureBoardLogPoller()

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

async function handleSetupStatus(url: URL, res: ServerResponse): Promise<void> {
  const group = url.searchParams.get("group") ?? undefined
  if (group && !(KNOWN_GROUP_IDS as readonly string[]).includes(group)) {
    json(res, 400, { error: "unknown_group", group })
    return
  }
  const report = await generateSetupReport({ group })
  json(res, 200, report)
}

function parseWorkspaceProfile(input: unknown, config: AppConfig): HarnessProfile {
  if (!input) return config.llm.defaultHarnessProfile
  return validateHarnessProfileShape(input)
}

// generateSetupReport({ allLlmGroups: true }) shells out to probe each LLM CLI
// (version + auth) on every call. registerWorkspace needs that report to
// validate harness availability, but running every POST /workspaces through
// those child processes makes the API needlessly slow. 30 s is short enough
// that a user who just installed a missing CLI can retry without restarting.
const SETUP_REPORT_TTL_MS = 30_000
let cachedSetupReport: { report: SetupReport; at: number } | null = null

async function getCachedSetupReport(): Promise<SetupReport> {
  if (cachedSetupReport && Date.now() - cachedSetupReport.at < SETUP_REPORT_TTL_MS) {
    return cachedSetupReport.report
  }
  const report = await generateSetupReport({ allLlmGroups: true })
  cachedSetupReport = { report, at: Date.now() }
  return report
}

async function handleWorkspacePreview(url: URL, res: ServerResponse): Promise<void> {
  const config = loadEffectiveConfig()
  if (!config) return json(res, 409, { error: "config_unavailable" })
  const path = url.searchParams.get("path")
  if (!path) return json(res, 400, { error: "path_required" })
  const preview = await previewWorkspace(path, config, repos)
  json(res, 200, preview)
}

async function handleWorkspaceAdd(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = loadEffectiveConfig()
  if (!config) return json(res, 409, { error: "config_unavailable" })
  const body = (await readJson(req)) as {
    path?: string
    create?: boolean
    name?: string
    key?: string
    harnessProfile?: HarnessProfile
    sonar?: RegisterWorkspaceInput["sonar"]
    git?: RegisterWorkspaceInput["git"]
  }
  if (!body.path) return json(res, 400, { error: "path_required" })
  let harnessProfile: HarnessProfile
  try {
    harnessProfile = parseWorkspaceProfile(body.harnessProfile, config)
  } catch (err) {
    return json(res, 400, { error: "invalid_harness_profile", detail: (err as Error).message })
  }
  const input: RegisterWorkspaceInput = {
    path: body.path,
    create: body.create,
    name: body.name,
    key: body.key,
    harnessProfile,
    sonar: body.sonar,
    git: body.git,
  }
  const appReport = await getCachedSetupReport()
  const result = await registerWorkspace(input, { repos, config, appReport })
  if (!result.ok) return json(res, 409, result)
  json(res, 200, result)
}

function handleWorkspaceList(res: ServerResponse): void {
  json(res, 200, { workspaces: listRegisteredWorkspaces(repos) })
}

function handleWorkspaceGet(res: ServerResponse, key: string): void {
  const workspace = getRegisteredWorkspace(repos, key)
  if (!workspace) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, workspace)
}

async function handleWorkspaceRemove(url: URL, res: ServerResponse, key: string): Promise<void> {
  const purge = url.searchParams.get("purge") === "1" || url.searchParams.get("purge") === "true"
  const config = purge ? loadEffectiveConfig() : null
  if (purge && !config) return json(res, 409, { error: "config_unavailable" })
  const result = await removeWorkspace(repos, key, {
    purge,
    allowedRoots: config?.allowedRoots,
  })
  if (!result.ok) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, result)
}

function handleWorkspaceOpen(res: ServerResponse, key: string): void {
  const rootPath = openWorkspace(repos, key)
  if (!rootPath) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, { key, rootPath })
}

async function handleWorkspaceBackfill(res: ServerResponse): Promise<void> {
  const result = await backfillWorkspaceConfigs(repos)
  json(res, 200, result)
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

async function handleResumeRun(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  const body = (await readJson(req)) as {
    summary?: string
    branch?: string
    commit?: string
    reviewNotes?: string
  }

  const readiness = await loadResumeReadiness(repos, runId)
  if (readiness.kind === "not_found") return json(res, 404, { error: "run_not_found" })
  if (readiness.kind === "no_recovery") {
    return json(res, 409, { error: "not_resumable", recovery: null })
  }
  if (readiness.kind === "not_resumable") {
    return json(res, 409, { error: readiness.reason, recovery: readiness.record ?? null })
  }
  if (!body.summary || body.summary.trim().length === 0) {
    return json(res, 422, { error: "remediation_required" })
  }
  if (isResumeInFlight(runId)) {
    return json(res, 409, { error: "resume_in_progress", recovery: readiness.record })
  }

  const scopeRef =
    readiness.record.scope.type === "stage"
      ? readiness.record.scope.stageId
      : readiness.record.scope.type === "story"
      ? `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
      : null
  const remediation = repos.createExternalRemediation({
    runId,
    scope: readiness.record.scope.type,
    scopeRef,
    summary: body.summary,
    branch: body.branch,
    commitSha: body.commit,
    reviewNotes: body.reviewNotes,
    source: "api",
  })

  // Reuse the API IO session machinery so SSE clients see the resumed run.
  const session = createApiIOSession(repos)
  sessions.set(runId, session)

  performResume({ repos, io: session.io, runId, remediation })
    .catch(err => console.error("[resume]", err))
    .finally(() => {
      setTimeout(() => {
        session.dispose()
        if (sessions.get(runId) === session) sessions.delete(runId)
      }, 30_000)
    })

  json(res, 200, { runId, remediationId: remediation.id, resumed: true })
}

function handleGetRecovery(res: ServerResponse, runId: string): void {
  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run_not_found" })
  if (!run.recovery_status) return json(res, 200, { recovery: null })
  json(res, 200, {
    recovery: {
      status: run.recovery_status,
      scope: run.recovery_scope,
      scopeRef: run.recovery_scope_ref,
      summary: run.recovery_summary,
      resumable: !isResumeInFlight(runId),
      remediations: repos.listExternalRemediations(runId),
    },
  })
}

async function handleRunInput(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  const body = (await readJson(req)) as { answer?: string; promptId?: string }
  if (!body.answer) return json(res, 400, { error: "answer is required" })

  const run = repos.getRun(runId)
  if (!run) return json(res, 404, { error: "run not found" })

  const promptId = body.promptId ?? repos.getOpenPrompt(runId)?.id
  if (!promptId) return json(res, 404, { error: "no open prompt" })

  // Preferred path: the run has an in-memory session in *this* process.
  // `session.answerPrompt` emits `prompt_answered` on that session's bus,
  // and `attachDbSync` + `withPromptPersistence` react by writing the
  // stage_log row and marking the pending_prompts row answered.
  const session = resolveSession(runId)
  if (session) {
    const ok = session.answerPrompt(promptId, body.answer)
    if (ok) return json(res, 200, { runId, promptId, answer: body.answer })
  }

  // Cross-process path: the run is owned by another process (typically the
  // CLI). We update `pending_prompts` and also write a `prompt_answered`
  // stage_log row — the CLI's `attachCrossProcessBridge` tails that log and
  // re-emits the event onto its local bus, resolving the pending `ask()`.
  const answered = repos.answerPendingPrompt(promptId, body.answer)
  if (!answered) return json(res, 404, { error: "prompt not pending" })

  repos.appendLog({
    runId,
    eventType: "prompt_answered",
    message: body.answer,
    data: { promptId, source: "api" },
  })

  json(res, 200, { runId, promptId, answer: body.answer })
}

// ---------------------------------------------------------------------------
// Run stream (/runs/:id/events) — single delivery model: tail stage_logs
// ---------------------------------------------------------------------------
//
// The previous implementation had two parallel delivery paths (in-memory
// session emitter + DB log poll) that had to be deduped by streamId. Now
// the DB log poll is the *only* source; in-memory events emitted by the
// run's bus land in `stage_logs` via `attachDbSync` and are picked up by the
// same poller that serves CLI-owned runs. One cursor, one dedup key (`log.id`).
function handleEvents(req: IncomingMessage, res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ runId, at: Date.now() })}\n\n`)

  const seenStreamIds = new Set<string>()
  let logCursor = 0
  let closed = false

  const writePersistedLog = (log: StageLogRow) => {
    if (closed || seenStreamIds.has(log.id)) return
    seenStreamIds.add(log.id)
    logCursor = Math.max(logCursor, log.created_at + 1)
    writeSse(res, log.event_type, {
      streamId: log.id,
      at: log.created_at,
      message: log.message,
      stageRunId: log.stage_run_id,
      data: parseLogData(log.data_json),
    })
    if (log.event_type === "run_finished") closeStream()
  }

  const pollOnce = () => {
    if (closed) return
    for (const log of repos.listLogsForRun(runId, logCursor)) {
      writePersistedLog(log)
    }
    // If the run ended without ever writing a `run_finished` log (edge case
    // for legacy or interrupted runs), close the stream once the DB shows
    // the run as non-running and the cursor has caught up.
    const run = repos.getRun(runId)
    if (run && run.status !== "running" && !closed) {
      const hasFinishedLog = repos
        .listLogsForRun(runId, 0)
        .some(log => log.event_type === "run_finished")
      if (!hasFinishedLog) closeStream()
    }
  }

  const pollTimer = setInterval(pollOnce, LOG_TAIL_INTERVAL_MS)
  pollTimer.unref?.()

  const closeStream = () => {
    if (closed) return
    closed = true
    clearInterval(pollTimer)
    res.end()
  }

  // Initial replay: everything already in the log.
  pollOnce()

  req.on("close", () => {
    closed = true
    clearInterval(pollTimer)
  })
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
  setCors(res, req)
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }
  if (!requireCsrfToken(req)) {
    return json(res, 403, { error: "csrf_token_required" })
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
    // GET /setup/status
    if (path === "/setup/status" && req.method === "GET") return handleSetupStatus(url, res)
    // GET /workspaces/preview?path=...
    if (path === "/workspaces/preview" && req.method === "GET") return handleWorkspacePreview(url, res)
    // GET /workspaces
    if (path === "/workspaces" && req.method === "GET") return handleWorkspaceList(res)
    // POST /workspaces
    if (path === "/workspaces" && req.method === "POST") return handleWorkspaceAdd(req, res)
    // POST /workspaces/backfill
    if (path === "/workspaces/backfill" && req.method === "POST") return handleWorkspaceBackfill(res)
    // GET /events — workspace-scoped board SSE stream
    if (path === "/events" && req.method === "GET") return handleBoardEvents(req, res)

    // /workspaces/:key + /workspaces/:key/open
    const workspaceMatch = path.match(/^\/workspaces\/([^/]+)(?:\/(open))?$/)
    if (workspaceMatch) {
      const [, key, sub] = workspaceMatch
      if (!sub && req.method === "GET") return handleWorkspaceGet(res, key)
      if (!sub && req.method === "DELETE") return handleWorkspaceRemove(url, res, key)
      if (sub === "open" && req.method === "POST") return handleWorkspaceOpen(res, key)
    }

    // POST /items/:id/actions
    const itemMatch = path.match(/^\/items\/([^/]+)\/actions$/)
    if (itemMatch && req.method === "POST") return handleItemAction(req, res, itemMatch[1])

    // /runs/:id + /runs/:id/input + /runs/:id/tree + /runs/:id/events + /runs/:id/prompts + /runs/:id/resume
    const runMatch = path.match(/^\/runs\/([^/]+)(?:\/(input|tree|events|prompts|resume|recovery))?$/)
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
      if (sub === "resume" && req.method === "POST") return handleResumeRun(req, res, runId)
      if (sub === "recovery" && req.method === "GET") return handleGetRecovery(res, runId)
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
  if (!API_TOKEN_WAS_PROVIDED) {
    // Written to stderr so stdout consumers (e.g. JSON emitters) stay clean.
    // The UI should export BEERENGINEER_API_TOKEN before it boots so it knows
    // the value without having to parse this line.
    console.error(`[engine] BEERENGINEER_API_TOKEN=${API_TOKEN}`)
  }
})

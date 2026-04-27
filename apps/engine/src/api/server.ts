import { createServer } from "node:http"
import { URL, fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { initDatabase } from "../db/connection.js"
import { Repos } from "../db/repositories.js"
import { createItemActionsService, type ItemActionEvent } from "../core/itemActions.js"
import {
  defaultAppConfig,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
} from "../setup/config.js"
import type { AppConfig } from "../setup/types.js"
import { json, requireCsrfToken, setCors } from "./http.js"
import { handleGetItem, handleGetItemDesign, handleGetItemWireframes, handleItemActionNamed, handleListItems } from "./routes/items.js"
import {
  handleAnswer,
  handleGetArtifactFile,
  handleGetArtifacts,
  handleCreateRun,
  handleGetBoard,
  handleGetConversation,
  handleGetMessages,
  handleGetRun,
  handleGetRunTree,
  handleGetRecovery,
  handlePostMessage,
  handleListRuns,
  handleResumeRun,
} from "./routes/runs.js"
import {
  handleWorkspaceAdd,
  handleWorkspaceBackfill,
  handleWorkspaceGet,
  handleWorkspaceList,
  handleWorkspaceOpen,
  handleWorkspacePreview,
  handleWorkspaceRemove,
} from "./routes/workspaces.js"
import { handleSetupStatus } from "./routes/setup.js"
import { handleNotificationDeliveries, handleNotificationTest } from "./routes/notifications.js"
import { handleTelegramChatToolWebhook } from "../notifications/chattool/webhooks/telegram.js"
import { handleRunEvents } from "./sse/runStream.js"
import { createBoardStream } from "./sse/boardStream.js"
import { seedIfEmpty } from "./seed.js"
import { writeApiTokenFile } from "./tokenFile.js"
import { markOrphanedRunsFailed } from "../core/orphanRecovery.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"
const API_TOKEN = process.env.BEERENGINEER_API_TOKEN ?? randomBytes(24).toString("hex")
const API_TOKEN_WAS_PROVIDED = Boolean(process.env.BEERENGINEER_API_TOKEN)
const ALLOWED_ORIGIN = process.env.BEERENGINEER_UI_ORIGIN ?? "http://127.0.0.1:3100"

const OPENAPI_PATH = resolvePath(dirname(fileURLToPath(import.meta.url)), "openapi.json")
let cachedOpenApi: string | null = null
function loadOpenApi(): string | null {
  if (cachedOpenApi !== null) return cachedOpenApi
  try {
    cachedOpenApi = readFileSync(OPENAPI_PATH, "utf8")
  } catch {
    cachedOpenApi = ""
  }
  return cachedOpenApi || null
}

const db = initDatabase()
const repos = new Repos(db)

const itemActions = createItemActionsService(repos)
const board = createBoardStream(repos, db)

// `itemActions` emits `item_column_changed` directly — it doesn't touch
// `stage_logs`. Lifecycle events (run_started, stage_started, …) are handled
// by the board stream's log tail instead; having two origins for the same
// event was the dedup bug we removed before.
itemActions.on("event", (ev: ItemActionEvent) => {
  if (ev.type === "item_column_changed") {
    board.broadcastItemColumnChanged({
      itemId: ev.itemId,
      from: ev.from,
      to: ev.to,
      phaseStatus: ev.phaseStatus,
    })
  }
})

function loadEffectiveConfig(): AppConfig | null {
  const overrides = resolveOverrides()
  return (resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides) as AppConfig | null)
    ?? defaultAppConfig()
}

seedIfEmpty(db, repos)

// On every fresh process start, any run still in status='running' has no live
// worker — the previous process died mid-flight. Mark them failed so
// POST /runs/:id/resume accepts them without a manual DB patch.
markOrphanedRunsFailed(repos).catch(err => {
  console.error("[orphanRecovery] startup scan failed:", (err as Error).message)
})

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) return json(res, 400, { error: "bad request" })
  setCors(res, req, ALLOWED_ORIGIN)
  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = url.pathname

  // Inbound webhooks authenticate via a channel-specific secret header
  // (Telegram sends `x-telegram-bot-api-secret-token`), not the engine's
  // CSRF token. Route them before the CSRF gate.
  if (path === "/webhooks/telegram" && req.method === "POST") {
    const config = loadEffectiveConfig()
    if (!config) return json(res, 500, { error: "config unavailable" })
    return handleTelegramChatToolWebhook(repos, config, req, res)
  }

  if (!requireCsrfToken(req, API_TOKEN)) {
    return json(res, 403, { error: "csrf_token_required" })
  }

  try {
    // ---- Runs (reads + intent recording) ------------------------------------
    if (path === "/runs" && req.method === "GET") return handleListRuns(repos, res)
    if (path === "/runs" && req.method === "POST") return handleCreateRun(repos, req, res)

    // ---- Board ---------------------------------------------------------------
    if (path === "/board" && req.method === "GET") return handleGetBoard(db, url, res)

    // ---- Setup ---------------------------------------------------------------
    if (path === "/setup/status" && req.method === "GET") return handleSetupStatus(url, res)

    // ---- Notifications -------------------------------------------------------
    const notificationTestMatch = path.match(/^\/notifications\/test\/([^/]+)$/)
    if (notificationTestMatch && req.method === "POST") {
      return handleNotificationTest(repos, loadEffectiveConfig, res, notificationTestMatch[1])
    }
    if (path === "/notifications/deliveries" && req.method === "GET") {
      return handleNotificationDeliveries(repos, url, res)
    }

    // ---- Workspaces ----------------------------------------------------------
    if (path === "/workspaces/preview" && req.method === "GET") {
      return handleWorkspacePreview(repos, loadEffectiveConfig, url, res)
    }
    if (path === "/workspaces" && req.method === "GET") return handleWorkspaceList(repos, res)
    if (path === "/workspaces" && req.method === "POST") return handleWorkspaceAdd(repos, loadEffectiveConfig, req, res)
    if (path === "/workspaces/backfill" && req.method === "POST") return handleWorkspaceBackfill(repos, res)

    const workspaceMatch = path.match(/^\/workspaces\/([^/]+)(?:\/(open))?$/)
    if (workspaceMatch) {
      const [, key, sub] = workspaceMatch
      if (!sub && req.method === "GET") return handleWorkspaceGet(repos, res, key)
      if (!sub && req.method === "DELETE") return handleWorkspaceRemove(repos, loadEffectiveConfig, url, res, key)
      if (sub === "open" && req.method === "POST") return handleWorkspaceOpen(repos, res, key)
    }

    // ---- Board SSE -----------------------------------------------------------
    if (path === "/events" && req.method === "GET") return board.handle(req, res)

    // ---- Items ---------------------------------------------------------------
    if (path === "/items" && req.method === "GET") return handleListItems(repos, url, res)
    const itemActionNamed = path.match(/^\/items\/([^/]+)\/actions\/([^/]+)$/)
    if (itemActionNamed && req.method === "POST") {
      return handleItemActionNamed(itemActions, repos, req, res, itemActionNamed[1], itemActionNamed[2])
    }
    const itemWireframesMatch = path.match(/^\/items\/([^/]+)\/wireframes$/)
    if (itemWireframesMatch && req.method === "GET") return handleGetItemWireframes(repos, res, itemWireframesMatch[1])
    const itemDesignMatch = path.match(/^\/items\/([^/]+)\/design$/)
    if (itemDesignMatch && req.method === "GET") return handleGetItemDesign(repos, res, itemDesignMatch[1])
    const itemMatch = path.match(/^\/items\/([^/]+)$/)
    if (itemMatch && req.method === "GET") return handleGetItem(repos, res, itemMatch[1])

    const runArtifactsFileMatch = path.match(/^\/runs\/([^/]+)\/artifacts\/(.+)$/)
    if (runArtifactsFileMatch && req.method === "GET") {
      return handleGetArtifactFile(repos, res, runArtifactsFileMatch[1], runArtifactsFileMatch[2])
    }
    const runArtifactsMatch = path.match(/^\/runs\/([^/]+)\/artifacts$/)
    if (runArtifactsMatch && req.method === "GET") return handleGetArtifacts(repos, res, runArtifactsMatch[1])

    // ---- Run-scoped subresources --------------------------------------------
    const runMatch = path.match(/^\/runs\/([^/]+)(?:\/(tree|events|messages|resume|recovery|conversation|answer))?$/)
    if (runMatch) {
      const [, runId, sub] = runMatch
      if (!sub && req.method === "GET") return handleGetRun(repos, res, runId)
      if (sub === "tree" && req.method === "GET") return handleGetRunTree(repos, res, runId)
      if (sub === "events" && req.method === "GET") return handleRunEvents(repos, req, res, runId)
      if (sub === "messages" && req.method === "GET") return handleGetMessages(repos, url, res, runId)
      if (sub === "messages" && req.method === "POST") return handlePostMessage(repos, req, res, runId)
      if (sub === "conversation" && req.method === "GET") return handleGetConversation(repos, res, runId)
      if (sub === "answer" && req.method === "POST") return handleAnswer(repos, req, res, runId)
      if (sub === "resume" && req.method === "POST") return handleResumeRun(repos, req, res, runId)
      if (sub === "recovery" && req.method === "GET") return handleGetRecovery(repos, res, runId)
    }

    // ---- OpenAPI spec --------------------------------------------------------
    if (path === "/openapi.json" && req.method === "GET") {
      const body = loadOpenApi()
      if (!body) return json(res, 503, { error: "openapi_unavailable", code: "service_unavailable" })
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(body)
      return
    }

    // ---- Health --------------------------------------------------------------
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
    const tokenPath = writeApiTokenFile(API_TOKEN)
    console.error(`[engine] BEERENGINEER_API_TOKEN=${API_TOKEN}`)
    console.error(`[engine] wrote token to ${tokenPath}`)
  }
})

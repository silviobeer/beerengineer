import type { ServerResponse } from "node:http"
import { URL } from "node:url"

import { json, requireCsrfToken } from "./http.js"
import { buildHealthResponse, buildReadyResponse } from "./health.js"
import { handleCreatePreparedImportItem, handleGetItem, handleGetItemDesign, handleGetItemPreview, handleGetItemWireframes, handleItemActionNamed, handleListItems, handleStartItemPreview, handleStopItemPreview } from "./routes/items.js"
import {
  handleAnswer,
  handleGetArtifactFile,
  handleGetArtifacts,
  handleCreateRun,
  handleGetBoard,
  handleGetConversation,
  handleGetMessages,
  handleGetMergeStatus,
  handleGetRun,
  handleGetRunTree,
  handleGetRecovery,
  handleSupabaseReadinessRetry,
  handlePostMessage,
  handleListRuns,
  handleResumeRun,
} from "./routes/runs.js"
import { handleRetryValidation } from "./routes/branchActions.js"
import {
  handleWorkspaceAdd,
  handleWorkspaceBackfill,
  handleWorkspaceSupabaseBranch,
  handleWorkspaceSupabaseConnect,
  handleWorkspaceGet,
  handleWorkspaceList,
  handleWorkspaceOpen,
  handleWorkspacePreview,
  handleWorkspaceSupabaseReadiness,
  handleWorkspaceSupabaseRotate,
  handleWorkspaceRemove,
} from "./routes/workspaces.js"
import {
  handleSecretAction,
  handleSecretMetadata,
  handleSetupConfig,
  handleSetupConfigPatch,
  handleSetupInit,
  handleSetupRecheck,
  handleSetupTelegramVerification,
  handleSetupTelegramWebhook,
  handleSetupStatus,
  handleSupabaseConnect,
  handleSupabaseDestroyBranch,
  handleSupabaseDisconnect,
  handleSupabaseRecreate,
  handleSupabaseRotate,
  handleSupabaseSettingsPatch,
} from "./routes/setup.js"
import {
  handleGitIdentitySave,
  handleGitReadiness,
  handleWorkspaceGitIdentityRepair,
} from "./routes/gitIdentity.js"
import {
  handleUpdateApply,
  handleUpdateCheck,
  handleUpdateHistory,
  handleUpdatePreflight,
  handleUpdateShutdown,
  handleUpdateStatus,
} from "./routes/update.js"
import { handleNotificationDeliveries, handleNotificationTest } from "./routes/notifications.js"
import { handleTelegramChatToolWebhook } from "../notifications/chattool/webhooks/telegram.js"
import { handleRunEvents } from "./sse/runStream.js"
import type { ApiHttpShell, ApiLifecycleView, ApiRequest, ApiRouteDependencies } from "./entrypointContracts.js"

type RouteContext = {
  req: ApiRequest
  res: ServerResponse
  url: URL
  path: string
  appConfig: ReturnType<ApiRouteDependencies["loadEffectiveConfig"]>
}

function attachRouteContext(
  req: ApiRequest,
  appConfig: RouteContext["appConfig"],
  deps: ApiRouteDependencies,
  lifecycle: ApiLifecycleView,
): void {
  req.repos = deps.repos
  req.appConfig = appConfig
  req.executePreparedApply = prepared => {
    deps.executePreparedApply(prepared, reason => lifecycle.requestShutdown(reason))
  }
}

function topLevelRouteHandlers(
  context: RouteContext,
  deps: ApiRouteDependencies,
  lifecycle: ApiLifecycleView,
): Partial<Record<string, () => void | Promise<void>>> {
  return {
    "GET /runs": () => handleListRuns(deps.repos, context.res),
    "POST /runs": () => handleCreateRun(deps.repos, context.req, context.res, payload => deps.board.broadcastItemColumnChanged(payload)),
    "POST /items/import-prepared": () => handleCreatePreparedImportItem(deps.repos, context.req, context.res, payload => deps.board.broadcastItemColumnChanged(payload)),
    "GET /board": () => handleGetBoard(deps.db, context.url, context.res),
    "GET /setup/status": () => handleSetupStatus(context.url, context.res),
    "GET /setup/config": () => handleSetupConfig(deps.repos, context.url, context.res),
    "GET /setup/git-readiness": () => handleGitReadiness(deps.repos, context.appConfig, context.url, context.res),
    "PATCH /setup/config": () => handleSetupConfigPatch(context.req, context.res),
    "POST /setup/telegram/webhook": () => handleSetupTelegramWebhook(deps.repos, context.appConfig, context.url, context.res),
    "POST /setup/telegram/verification": () => handleSetupTelegramVerification(deps.repos, context.appConfig, context.url, context.res),
    "POST /setup/git-identity": () => handleGitIdentitySave(context.req, context.res),
    "POST /setup/git-identity/repair": () => handleWorkspaceGitIdentityRepair(deps.repos, context.appConfig, context.req, context.res),
    "POST /setup/init": () => handleSetupInit(context.res),
    "POST /setup/recheck": () => handleSetupRecheck(context.req, context.res),
    "POST /setup/supabase/connect": () => handleSupabaseConnect(deps.repos, context.req, context.res),
    "POST /setup/supabase/disconnect": () => handleSupabaseDisconnect(deps.repos, context.req, context.res),
    "POST /setup/supabase/destroy": () => handleSupabaseDestroyBranch({ repos: deps.repos, req: context.req, res: context.res }),
    "POST /setup/supabase/recreate": () => handleSupabaseRecreate(deps.repos, context.req, context.res),
    "POST /setup/supabase/rotate": () => handleSupabaseRotate(context.req, context.res),
    "PATCH /setup/supabase/settings": () => handleSupabaseSettingsPatch(deps.repos, context.req, context.res),
    "GET /update/status": () => handleUpdateStatus(deps.repos, context.appConfig, context.res, { pid: process.pid }),
    "GET /update/preflight": () => handleUpdatePreflight(deps.repos, context.appConfig, context.res, { pid: process.pid }),
    "POST /update/check": () => handleUpdateCheck(context.req, context.res),
    "POST /update/apply": () => handleUpdateApply(context.req, context.res),
    "GET /update/history": () => handleUpdateHistory(deps.repos, context.appConfig, context.res),
    "POST /update/rollback": () => json(context.res, 409, {
      error: "post-migration-rollback-unsupported",
      code: "post-migration-rollback-unsupported",
    }),
    "POST /update/shutdown": () => handleUpdateShutdown(context.req, context.res, {
      requestShutdown: operationId => void lifecycle.requestShutdown(`update:${operationId}`),
    }),
    "GET /events": () => deps.board.handle(context.req, context.res),
    "GET /health": () => {
      const health = buildHealthResponse(deps.db)
      json(context.res, health.status, health.body)
    },
    "GET /ready": () => {
      const ready = buildReadyResponse(deps.db, deps.repos, {
        startupRecoveryComplete: lifecycle.isStartupRecoveryComplete(),
        shutdownInFlight: lifecycle.isShutdownInFlight(),
      })
      json(context.res, ready.status, ready.body)
    },
  }
}

function itemRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void }> {
  return [
    { pattern: /^\/items\/([^/]+)\/actions\/([^/]+)$/, method: "POST", handle: (itemId, action) => handleItemActionNamed(deps.itemActions, deps.repos, context.req, context.res, itemId, action, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { pattern: /^\/items\/([^/]+)\/wireframes$/, method: "GET", handle: itemId => handleGetItemWireframes(deps.repos, context.res, itemId) },
    { pattern: /^\/items\/([^/]+)\/design$/, method: "GET", handle: itemId => handleGetItemDesign(deps.repos, context.res, itemId) },
    { pattern: /^\/items\/([^/]+)\/preview\/start$/, method: "POST", handle: itemId => handleStartItemPreview(deps.repos, context.req, context.res, itemId) },
    { pattern: /^\/items\/([^/]+)\/preview\/stop$/, method: "POST", handle: itemId => handleStopItemPreview(deps.repos, context.req, context.res, itemId) },
    { pattern: /^\/items\/([^/]+)\/preview$/, method: "GET", handle: itemId => handleGetItemPreview(deps.repos, context.res, itemId) },
    { pattern: /^\/items\/([^/]+)$/, method: "GET", handle: itemId => handleGetItem(deps.repos, context.res, itemId) },
  ]
}

function runRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void }> {
  return [
    { pattern: /^\/runs\/([^/]+)\/artifacts\/(.+)$/, method: "GET", handle: (runId, artifactPath) => handleGetArtifactFile(deps.repos, context.res, runId, artifactPath) },
    { pattern: /^\/runs\/([^/]+)\/artifacts$/, method: "GET", handle: runId => handleGetArtifacts(deps.repos, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)$/, method: "GET", handle: runId => handleGetRun(deps.repos, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/tree$/, method: "GET", handle: runId => handleGetRunTree(deps.repos, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/merge-status$/, method: "GET", handle: runId => handleGetMergeStatus(deps.repos, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/events$/, method: "GET", handle: runId => handleRunEvents(deps.repos, context.req, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/messages$/, method: "GET", handle: runId => handleGetMessages(deps.repos, context.url, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/messages$/, method: "POST", handle: runId => handlePostMessage(deps.repos, context.req, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/conversation$/, method: "GET", handle: runId => handleGetConversation(deps.repos, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/answer$/, method: "POST", handle: runId => handleAnswer(deps.repos, context.req, context.res, runId) },
    { pattern: /^\/runs\/([^/]+)\/resume$/, method: "POST", handle: runId => handleResumeRun(deps.repos, context.req, context.res, runId, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { pattern: /^\/runs\/([^/]+)\/supabase-readiness\/retry$/, method: "POST", handle: runId => handleSupabaseReadinessRetry(deps.repos, context.req, context.res, runId, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { pattern: /^\/runs\/([^/]+)\/recovery$/, method: "GET", handle: runId => handleGetRecovery(deps.repos, context.res, runId) },
  ]
}

function supabaseActionRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void | Promise<void> }> {
  return [
    {
      pattern: /^\/supabase\/branches\/([^/]+)\/retry-validation$/,
      method: "POST",
      handle: async branchRef => {
        const adapter = deps.createSupabaseValidationAdapter()
        await handleRetryValidation({ repos: deps.repos, adapter, req: context.req, res: context.res, branchRef })
      },
    },
  ]
}

async function handleRouteMatchers(
  context: RouteContext,
  matchers: Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void | Promise<void> }>,
): Promise<boolean> {
  for (const matcher of matchers) {
    if (context.req.method !== matcher.method) continue
    const match = matcher.pattern.exec(context.path)
    if (!match) continue
    await matcher.handle(...match.slice(1))
    return true
  }
  return false
}

async function handlePreCsrfRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  if (context.path !== "/webhooks/telegram" || context.req.method !== "POST") return false
  handleTelegramChatToolWebhook(deps.repos, context.appConfig, context.req, context.res)
  return true
}

async function handleTopLevelRoutes(context: RouteContext, deps: ApiRouteDependencies, lifecycle: ApiLifecycleView): Promise<boolean> {
  const handler = topLevelRouteHandlers(context, deps, lifecycle)[`${context.req.method} ${context.path}`]
  if (handler) {
    await handler()
    return true
  }
  if (context.path === "/openapi.json" && context.req.method === "GET") {
    const body = deps.loadOpenApi()
    if (!body) {
      json(context.res, 503, { error: "openapi_unavailable", code: "service_unavailable" })
      return true
    }
    context.res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    context.res.end(body)
    return true
  }
  return false
}

async function handleNotificationRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const notificationTestMatch = /^\/notifications\/test\/([^/]+)$/.exec(context.path)
  if (notificationTestMatch && context.req.method === "POST") {
    handleNotificationTest(deps.repos, deps.loadEffectiveConfig, context.res, notificationTestMatch[1])
    return true
  }
  if (context.path === "/notifications/deliveries" && context.req.method === "GET") {
    handleNotificationDeliveries(deps.repos, context.url, context.res)
    return true
  }
  return false
}

async function handleSetupRoutes(context: RouteContext): Promise<boolean> {
  const secretMatch = /^\/setup\/secrets\/([^/]+)$/.exec(context.path)
  if (secretMatch && context.req.method === "GET") {
    await handleSecretMetadata(context.res, secretMatch[1])
    return true
  }
  if (secretMatch && context.req.method === "POST") {
    await handleSecretAction(context.req, context.res, secretMatch[1])
    return true
  }
  return false
}

async function handleWorkspaceCollectionRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context
  if (path === "/workspaces/preview" && req.method === "GET") { handleWorkspacePreview(deps.repos, deps.loadEffectiveConfig, url, res); return true }
  if (path === "/workspaces" && req.method === "GET") { handleWorkspaceList(deps.repos, res); return true }
  if (path === "/workspaces" && req.method === "POST") { handleWorkspaceAdd(deps.repos, deps.loadEffectiveConfig, req, res); return true }
  if (path === "/workspaces/backfill" && req.method === "POST") { handleWorkspaceBackfill(deps.repos, res); return true }
  return false
}

async function handleWorkspaceSupabaseRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context
  const supabaseMatch = /^\/workspaces\/([^/]+)\/supabase\/(readiness|connect|rotate|branch)$/.exec(path)
  if (!supabaseMatch) return false

  const [, key, sub] = supabaseMatch
  if (sub === "readiness" && req.method === "GET") {
    await handleWorkspaceSupabaseReadiness(deps.repos, res, key, url.searchParams.get("runId"))
    return true
  }
  if (sub === "connect" && req.method === "POST") {
    await handleWorkspaceSupabaseConnect(deps.repos, req, res, key)
    return true
  }
  if (sub === "rotate" && req.method === "POST") {
    await handleWorkspaceSupabaseRotate(deps.repos, req, res, key)
    return true
  }
  if (sub === "branch" && req.method === "POST") {
    await handleWorkspaceSupabaseBranch(deps.repos, req, res, key)
    return true
  }
  return false
}

async function handleWorkspaceDetailRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context
  const workspaceMatch = /^\/workspaces\/([^/]+)(?:\/(open))?$/.exec(path)
  if (!workspaceMatch) return false

  const [, key, sub] = workspaceMatch
  if (sub === undefined) {
    if (req.method === "GET") { handleWorkspaceGet(deps.repos, res, key); return true }
    if (req.method === "DELETE") { handleWorkspaceRemove(deps.repos, deps.loadEffectiveConfig, url, res, key); return true }
    return false
  }
  if (sub === "open" && req.method === "POST") { handleWorkspaceOpen(deps.repos, res, key); return true }
  return false
}

async function handleWorkspaceRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  if (await handleWorkspaceCollectionRoutes(context, deps)) return true
  if (await handleWorkspaceSupabaseRoutes(context, deps)) return true
  return await handleWorkspaceDetailRoutes(context, deps)
}

async function handleItemRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  if (context.path === "/items" && context.req.method === "GET") {
    handleListItems(deps.repos, context.url, context.res)
    return true
  }
  return await handleRouteMatchers(context, itemRouteMatchers(context, deps))
}

async function handleRunRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  return await handleRouteMatchers(context, runRouteMatchers(context, deps))
}

async function handleSupabaseActionRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  return await handleRouteMatchers(context, supabaseActionRouteMatchers(context, deps))
}

export function registerApiRoutes(
  shell: Pick<ApiHttpShell, "setRequestHandler">,
  deps: ApiRouteDependencies,
  lifecycle: ApiLifecycleView,
): void {
  shell.setRequestHandler(async (req, res) => {
    const url = new URL(req.url!, `http://${deps.host}:${deps.port}`)
    const path = url.pathname
    const appConfig = deps.loadEffectiveConfig()
    attachRouteContext(req, appConfig, deps, lifecycle)
    const context: RouteContext = { req, res, url, path, appConfig }

    if (await handlePreCsrfRoutes(context, deps)) return

    if (!requireCsrfToken(req, deps.apiToken)) {
      json(res, 403, { error: "csrf_token_required" })
      return
    }

    if (await handleTopLevelRoutes(context, deps, lifecycle)) return
    if (await handleSetupRoutes(context)) return
    if (await handleNotificationRoutes(context, deps)) return
    if (await handleWorkspaceRoutes(context, deps)) return
    if (await handleItemRoutes(context, deps)) return
    if (await handleRunRoutes(context, deps)) return
    if (await handleSupabaseActionRoutes(context, deps)) return

    json(res, 404, { error: "not found" })
  })
}

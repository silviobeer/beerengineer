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
  handleReplanRun,
  handleGetRun,
  handleGetRunTree,
  handleGetRecovery,
  handleSupabaseReadinessRetry,
  handlePostMessage,
  handleListRuns,
  handleRetryRetainedRecovery,
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

type RouteSurfaceDefinition = {
  method: string
  surfacePath: string
}

type RouteMatcherDefinition = RouteSurfaceDefinition & {
  pattern: RegExp
}

type RouteContext = {
  req: ApiRequest
  res: ServerResponse
  url: URL
  path: string
  appConfig: ReturnType<ApiRouteDependencies["loadEffectiveConfig"]>
}

const WEBHOOK_TELEGRAM_ROUTE = {
  method: "POST",
  surfacePath: "/webhooks/telegram",
} as const satisfies RouteSurfaceDefinition

const OPENAPI_ROUTE = {
  method: "GET",
  surfacePath: "/openapi.json",
} as const satisfies RouteSurfaceDefinition

const TOP_LEVEL_ROUTE_KEYS = [
  "GET /runs",
  "POST /runs",
  "POST /items/import-prepared",
  "GET /board",
  "GET /setup/status",
  "GET /setup/config",
  "GET /setup/git-readiness",
  "PATCH /setup/config",
  "POST /setup/telegram/webhook",
  "POST /setup/telegram/verification",
  "POST /setup/git-identity",
  "POST /setup/git-identity/repair",
  "POST /setup/init",
  "POST /setup/recheck",
  "POST /setup/supabase/connect",
  "POST /setup/supabase/disconnect",
  "POST /setup/supabase/destroy",
  "POST /setup/supabase/recreate",
  "POST /setup/supabase/rotate",
  "PATCH /setup/supabase/settings",
  "GET /update/status",
  "GET /update/preflight",
  "POST /update/check",
  "POST /update/apply",
  "GET /update/history",
  "POST /update/rollback",
  "POST /update/shutdown",
  "GET /events",
  "GET /health",
  "GET /ready",
] as const

const ITEM_ROUTE_DEFINITIONS = [
  { pattern: /^\/items\/([^/]+)\/actions\/([^/]+)$/, method: "POST", surfacePath: "/items/{id}/actions/{action}" },
  { pattern: /^\/items\/([^/]+)\/wireframes$/, method: "GET", surfacePath: "/items/{id}/wireframes" },
  { pattern: /^\/items\/([^/]+)\/design$/, method: "GET", surfacePath: "/items/{id}/design" },
  { pattern: /^\/items\/([^/]+)\/preview\/start$/, method: "POST", surfacePath: "/items/{id}/preview/start" },
  { pattern: /^\/items\/([^/]+)\/preview\/stop$/, method: "POST", surfacePath: "/items/{id}/preview/stop" },
  { pattern: /^\/items\/([^/]+)\/preview$/, method: "GET", surfacePath: "/items/{id}/preview" },
  { pattern: /^\/items\/([^/]+)$/, method: "GET", surfacePath: "/items/{id}" },
] as const satisfies readonly RouteMatcherDefinition[]

const RUN_ROUTE_DEFINITIONS = [
  { pattern: /^\/runs\/([^/]+)\/artifacts\/(.+)$/, method: "GET", surfacePath: "/runs/{id}/artifacts/{path}" },
  { pattern: /^\/runs\/([^/]+)\/artifacts$/, method: "GET", surfacePath: "/runs/{id}/artifacts" },
  { pattern: /^\/runs\/([^/]+)$/, method: "GET", surfacePath: "/runs/{id}" },
  { pattern: /^\/runs\/([^/]+)\/tree$/, method: "GET", surfacePath: "/runs/{id}/tree" },
  { pattern: /^\/runs\/([^/]+)\/merge-status$/, method: "GET", surfacePath: "/runs/{id}/merge-status" },
  { pattern: /^\/runs\/([^/]+)\/events$/, method: "GET", surfacePath: "/runs/{id}/events" },
  { pattern: /^\/runs\/([^/]+)\/messages$/, method: "GET", surfacePath: "/runs/{id}/messages" },
  { pattern: /^\/runs\/([^/]+)\/messages$/, method: "POST", surfacePath: "/runs/{id}/messages" },
  { pattern: /^\/runs\/([^/]+)\/conversation$/, method: "GET", surfacePath: "/runs/{id}/conversation" },
  { pattern: /^\/runs\/([^/]+)\/answer$/, method: "POST", surfacePath: "/runs/{id}/answer" },
  { pattern: /^\/runs\/([^/]+)\/resume$/, method: "POST", surfacePath: "/runs/{id}/resume" },
  { pattern: /^\/runs\/([^/]+)\/replan$/, method: "POST", surfacePath: "/runs/{id}/replan" },
  { pattern: /^\/runs\/([^/]+)\/supabase-readiness\/retry$/, method: "POST", surfacePath: "/runs/{id}/supabase-readiness/retry" },
  { pattern: /^\/runs\/([^/]+)\/recovery\/retry-retained$/, method: "POST", surfacePath: "/runs/{id}/recovery/retry-retained" },
  { pattern: /^\/runs\/([^/]+)\/recovery$/, method: "GET", surfacePath: "/runs/{id}/recovery" },
] as const satisfies readonly RouteMatcherDefinition[]

const SUPABASE_ACTION_ROUTE_DEFINITIONS = [
  {
    pattern: /^\/supabase\/branches\/([^/]+)\/retry-validation$/,
    method: "POST",
    surfacePath: "/supabase/branches/{branchRef}/retry-validation",
  },
] as const satisfies readonly RouteMatcherDefinition[]

const NOTIFICATION_TEST_ROUTE = {
  pattern: /^\/notifications\/test\/([^/]+)$/,
  method: "POST",
  surfacePath: "/notifications/test/{channel}",
} as const satisfies RouteMatcherDefinition

const NOTIFICATION_DELIVERIES_ROUTE = {
  method: "GET",
  surfacePath: "/notifications/deliveries",
} as const satisfies RouteSurfaceDefinition

const SETUP_SECRET_METADATA_ROUTE = {
  pattern: /^\/setup\/secrets\/([^/]+)$/,
  method: "GET",
  surfacePath: "/setup/secrets/{ref}",
} as const satisfies RouteMatcherDefinition

const SETUP_SECRET_ACTION_ROUTE = {
  pattern: /^\/setup\/secrets\/([^/]+)$/,
  method: "POST",
  surfacePath: "/setup/secrets/{ref}",
} as const satisfies RouteMatcherDefinition

const WORKSPACE_COLLECTION_ROUTES = {
  preview: { method: "GET", surfacePath: "/workspaces/preview" },
  list: { method: "GET", surfacePath: "/workspaces" },
  add: { method: "POST", surfacePath: "/workspaces" },
  backfill: { method: "POST", surfacePath: "/workspaces/backfill" },
} as const satisfies Record<string, RouteSurfaceDefinition>

const WORKSPACE_SUPABASE_ROUTE_DEFINITIONS = [
  {
    pattern: /^\/workspaces\/([^/]+)\/supabase\/readiness$/,
    method: "GET",
    surfacePath: "/workspaces/{key}/supabase/readiness",
  },
  {
    pattern: /^\/workspaces\/([^/]+)\/supabase\/connect$/,
    method: "POST",
    surfacePath: "/workspaces/{key}/supabase/connect",
  },
  {
    pattern: /^\/workspaces\/([^/]+)\/supabase\/rotate$/,
    method: "POST",
    surfacePath: "/workspaces/{key}/supabase/rotate",
  },
  {
    pattern: /^\/workspaces\/([^/]+)\/supabase\/branch$/,
    method: "POST",
    surfacePath: "/workspaces/{key}/supabase/branch",
  },
] as const satisfies readonly RouteMatcherDefinition[]

const WORKSPACE_DETAIL_ROUTE = {
  pattern: /^\/workspaces\/([^/]+)$/,
  method: "GET",
  surfacePath: "/workspaces/{key}",
} as const satisfies RouteMatcherDefinition

const WORKSPACE_REMOVE_ROUTE = {
  pattern: /^\/workspaces\/([^/]+)$/,
  method: "DELETE",
  surfacePath: "/workspaces/{key}",
} as const satisfies RouteMatcherDefinition

const WORKSPACE_OPEN_ROUTE = {
  pattern: /^\/workspaces\/([^/]+)\/open$/,
  method: "POST",
  surfacePath: "/workspaces/{key}/open",
} as const satisfies RouteMatcherDefinition

function compareRoutes(left: string, right: string): number {
  return left.localeCompare(right)
}

export function listImplementedApiRouteSurface(): string[] {
  const implementedRoutes = [
    WEBHOOK_TELEGRAM_ROUTE,
    OPENAPI_ROUTE,
    ...TOP_LEVEL_ROUTE_KEYS.map(key => {
      const [method, ...pathParts] = key.split(" ")
      return { method, surfacePath: pathParts.join(" ") }
    }),
    { method: "GET", surfacePath: "/items" },
    ...ITEM_ROUTE_DEFINITIONS,
    ...RUN_ROUTE_DEFINITIONS,
    ...SUPABASE_ACTION_ROUTE_DEFINITIONS,
    NOTIFICATION_TEST_ROUTE,
    NOTIFICATION_DELIVERIES_ROUTE,
    SETUP_SECRET_METADATA_ROUTE,
    SETUP_SECRET_ACTION_ROUTE,
    ...Object.values(WORKSPACE_COLLECTION_ROUTES),
    ...WORKSPACE_SUPABASE_ROUTE_DEFINITIONS,
    WORKSPACE_DETAIL_ROUTE,
    WORKSPACE_REMOVE_ROUTE,
    WORKSPACE_OPEN_ROUTE,
  ]

  return [...new Set(implementedRoutes.map(route => `${route.method} ${route.surfacePath}`))].sort(compareRoutes)
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
): Record<(typeof TOP_LEVEL_ROUTE_KEYS)[number], () => void | Promise<void>> {
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
  } satisfies Record<(typeof TOP_LEVEL_ROUTE_KEYS)[number], () => void | Promise<void>>
}

function itemRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void }> {
  return [
    { ...ITEM_ROUTE_DEFINITIONS[0], handle: (itemId, action) => handleItemActionNamed(deps.itemActions, deps.repos, context.req, context.res, itemId, action, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { ...ITEM_ROUTE_DEFINITIONS[1], handle: itemId => handleGetItemWireframes(deps.repos, context.res, itemId) },
    { ...ITEM_ROUTE_DEFINITIONS[2], handle: itemId => handleGetItemDesign(deps.repos, context.res, itemId) },
    { ...ITEM_ROUTE_DEFINITIONS[3], handle: itemId => handleStartItemPreview(deps.repos, context.req, context.res, itemId) },
    { ...ITEM_ROUTE_DEFINITIONS[4], handle: itemId => handleStopItemPreview(deps.repos, context.req, context.res, itemId) },
    { ...ITEM_ROUTE_DEFINITIONS[5], handle: itemId => handleGetItemPreview(deps.repos, context.res, itemId) },
    { ...ITEM_ROUTE_DEFINITIONS[6], handle: itemId => handleGetItem(deps.repos, context.res, itemId) },
  ]
}

function runRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void }> {
  return [
    { ...RUN_ROUTE_DEFINITIONS[0], handle: (runId, artifactPath) => handleGetArtifactFile(deps.repos, context.res, runId, artifactPath) },
    { ...RUN_ROUTE_DEFINITIONS[1], handle: runId => handleGetArtifacts(deps.repos, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[2], handle: runId => handleGetRun(deps.repos, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[3], handle: runId => handleGetRunTree(deps.repos, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[4], handle: runId => handleGetMergeStatus(deps.repos, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[5], handle: runId => handleRunEvents(deps.repos, context.req, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[6], handle: runId => handleGetMessages(deps.repos, context.url, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[7], handle: runId => handlePostMessage(deps.repos, context.req, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[8], handle: runId => handleGetConversation(deps.repos, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[9], handle: runId => handleAnswer(deps.repos, context.req, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[10], handle: runId => handleResumeRun(deps.repos, context.req, context.res, runId, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { ...RUN_ROUTE_DEFINITIONS[11], handle: runId => handleReplanRun(deps.repos, context.req, context.res, runId) },
    { ...RUN_ROUTE_DEFINITIONS[12], handle: runId => handleSupabaseReadinessRetry(deps.repos, context.req, context.res, runId, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { ...RUN_ROUTE_DEFINITIONS[13], handle: runId => handleRetryRetainedRecovery(deps.repos, context.req, context.res, runId, payload => deps.board.broadcastItemColumnChanged(payload)) },
    { ...RUN_ROUTE_DEFINITIONS[14], handle: runId => handleGetRecovery(deps.repos, context.res, runId) },
  ]
}

function supabaseActionRouteMatchers(context: RouteContext, deps: ApiRouteDependencies): Array<{ pattern: RegExp; method: string; handle: (...captures: string[]) => void | Promise<void> }> {
  return [
    {
      ...SUPABASE_ACTION_ROUTE_DEFINITIONS[0],
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
  if (context.path !== WEBHOOK_TELEGRAM_ROUTE.surfacePath || context.req.method !== WEBHOOK_TELEGRAM_ROUTE.method) return false
  await handleTelegramChatToolWebhook(deps.repos, context.appConfig, context.req, context.res)
  return true
}

async function handleTopLevelRoutes(context: RouteContext, deps: ApiRouteDependencies, lifecycle: ApiLifecycleView): Promise<boolean> {
  const handler = topLevelRouteHandlers(context, deps, lifecycle)[`${context.req.method} ${context.path}` as (typeof TOP_LEVEL_ROUTE_KEYS)[number]]
  if (handler) {
    await handler()
    return true
  }
  if (context.path === OPENAPI_ROUTE.surfacePath && context.req.method === OPENAPI_ROUTE.method) {
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
  const notificationTestMatch = NOTIFICATION_TEST_ROUTE.pattern.exec(context.path)
  if (notificationTestMatch && context.req.method === NOTIFICATION_TEST_ROUTE.method) {
    await handleNotificationTest(deps.repos, deps.loadEffectiveConfig, context.res, notificationTestMatch[1])
    return true
  }
  if (context.path === NOTIFICATION_DELIVERIES_ROUTE.surfacePath && context.req.method === NOTIFICATION_DELIVERIES_ROUTE.method) {
    handleNotificationDeliveries(deps.repos, context.url, context.res)
    return true
  }
  return false
}

async function handleSetupRoutes(context: RouteContext): Promise<boolean> {
  const secretMatch = SETUP_SECRET_METADATA_ROUTE.pattern.exec(context.path)
  if (secretMatch && context.req.method === SETUP_SECRET_METADATA_ROUTE.method) {
    await handleSecretMetadata(context.res, secretMatch[1])
    return true
  }
  if (secretMatch && context.req.method === SETUP_SECRET_ACTION_ROUTE.method) {
    await handleSecretAction(context.req, context.res, secretMatch[1])
    return true
  }
  return false
}

async function handleWorkspaceCollectionRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context
  if (path === WORKSPACE_COLLECTION_ROUTES.preview.surfacePath && req.method === WORKSPACE_COLLECTION_ROUTES.preview.method) { await handleWorkspacePreview(deps.repos, deps.loadEffectiveConfig, url, res); return true }
  if (path === WORKSPACE_COLLECTION_ROUTES.list.surfacePath && req.method === WORKSPACE_COLLECTION_ROUTES.list.method) { handleWorkspaceList(deps.repos, res); return true }
  if (path === WORKSPACE_COLLECTION_ROUTES.add.surfacePath && req.method === WORKSPACE_COLLECTION_ROUTES.add.method) { await handleWorkspaceAdd(deps.repos, deps.loadEffectiveConfig, req, res); return true }
  if (path === WORKSPACE_COLLECTION_ROUTES.backfill.surfacePath && req.method === WORKSPACE_COLLECTION_ROUTES.backfill.method) { await handleWorkspaceBackfill(deps.repos, res); return true }
  return false
}

async function handleWorkspaceSupabaseRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context

  const readinessMatch = WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[0].pattern.exec(path)
  if (readinessMatch && req.method === WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[0].method) {
    await handleWorkspaceSupabaseReadiness(deps.repos, res, readinessMatch[1], url.searchParams.get("runId"))
    return true
  }

  const connectMatch = WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[1].pattern.exec(path)
  if (connectMatch && req.method === WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[1].method) {
    await handleWorkspaceSupabaseConnect(deps.repos, req, res, connectMatch[1])
    return true
  }

  const rotateMatch = WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[2].pattern.exec(path)
  if (rotateMatch && req.method === WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[2].method) {
    await handleWorkspaceSupabaseRotate(deps.repos, req, res, rotateMatch[1])
    return true
  }

  const branchMatch = WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[3].pattern.exec(path)
  if (branchMatch && req.method === WORKSPACE_SUPABASE_ROUTE_DEFINITIONS[3].method) {
    await handleWorkspaceSupabaseBranch(deps.repos, req, res, branchMatch[1])
    return true
  }

  return false
}

async function handleWorkspaceDetailRoutes(context: RouteContext, deps: ApiRouteDependencies): Promise<boolean> {
  const { path, req, res, url } = context

  const workspaceGetMatch = WORKSPACE_DETAIL_ROUTE.pattern.exec(path)
  if (workspaceGetMatch && req.method === WORKSPACE_DETAIL_ROUTE.method) {
    handleWorkspaceGet(deps.repos, res, workspaceGetMatch[1])
    return true
  }

  const workspaceDeleteMatch = WORKSPACE_REMOVE_ROUTE.pattern.exec(path)
  if (workspaceDeleteMatch && req.method === WORKSPACE_REMOVE_ROUTE.method) {
    handleWorkspaceRemove(deps.repos, deps.loadEffectiveConfig, url, res, workspaceDeleteMatch[1])
    return true
  }

  const workspaceOpenMatch = WORKSPACE_OPEN_ROUTE.pattern.exec(path)
  if (workspaceOpenMatch && req.method === WORKSPACE_OPEN_ROUTE.method) {
    handleWorkspaceOpen(deps.repos, res, workspaceOpenMatch[1])
    return true
  }

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

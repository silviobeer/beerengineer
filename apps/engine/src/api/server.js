import { createServer } from "node:http";
import { URL, fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { initDatabase } from "../db/connection.js";
import { Repos } from "../db/repositories.js";
import { createItemActionsService } from "../core/itemActions.js";
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides, } from "../setup/config.js";
import { json, requireCsrfToken, setCors } from "./http.js";
import { handleGetItem, handleGetItemDesign, handleGetItemPreview, handleGetItemWireframes, handleItemActionNamed, handleListItems, handleStartItemPreview, handleStopItemPreview } from "./routes/items.js";
import { handleAnswer, handleGetArtifactFile, handleGetArtifacts, handleCreateRun, handleGetBoard, handleGetConversation, handleGetMessages, handleGetRun, handleGetRunTree, handleGetRecovery, handlePostMessage, handleListRuns, handleResumeRun, } from "./routes/runs.js";
import { handleWorkspaceAdd, handleWorkspaceBackfill, handleWorkspaceGet, handleWorkspaceList, handleWorkspaceOpen, handleWorkspacePreview, handleWorkspaceRemove, } from "./routes/workspaces.js";
import { handleSetupStatus } from "./routes/setup.js";
import { handleUpdateApply, handleUpdateCheck, handleUpdateHistory, handleUpdatePreflight, handleUpdateShutdown, handleUpdateStatus, } from "./routes/update.js";
import { handleNotificationDeliveries, handleNotificationTest } from "./routes/notifications.js";
import { handleTelegramChatToolWebhook } from "../notifications/chattool/webhooks/telegram.js";
import { handleRunEvents } from "./sse/runStream.js";
import { createBoardStream } from "./sse/boardStream.js";
import { seedIfEmpty } from "./seed.js";
import { writeApiTokenFile } from "./tokenFile.js";
import { removeEnginePidFile, writeEnginePidFile } from "./pidFile.js";
import { markOrphanedRunsFailed } from "../core/orphanRecovery.js";
import { pruneMissingWorktreeAssignments } from "../core/portAllocator.js";
import { markPreparedUpdateInFlight, releaseUpdateLock } from "../core/updateMode.js";
const PORT = Number(process.env.PORT ?? 4100);
const HOST = process.env.HOST ?? "127.0.0.1";
const API_TOKEN = process.env.BEERENGINEER_API_TOKEN ?? randomBytes(24).toString("hex");
const API_TOKEN_WAS_PROVIDED = Boolean(process.env.BEERENGINEER_API_TOKEN);
const ALLOWED_ORIGIN = process.env.BEERENGINEER_UI_ORIGIN ?? "http://127.0.0.1:3100";
const OPENAPI_PATH = resolvePath(dirname(fileURLToPath(import.meta.url)), "openapi.json");
let cachedOpenApi = null;
function loadOpenApi() {
    if (cachedOpenApi !== null)
        return cachedOpenApi;
    try {
        cachedOpenApi = readFileSync(OPENAPI_PATH, "utf8");
    }
    catch {
        cachedOpenApi = "";
    }
    return cachedOpenApi || null;
}
const db = initDatabase();
const repos = new Repos(db);
const itemActions = createItemActionsService(repos);
const board = createBoardStream(repos, db);
const sockets = new Set();
let shutdownInFlight = false;
function startPreparedApplyExecution(prepared) {
    try {
        if (!existsSync(prepared.switcherPath)) {
            throw new Error("prepared_switcher_missing");
        }
        const managedCurrent = join(loadEffectiveConfig().dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js");
        if (!existsSync(managedCurrent)) {
            console.error("[update] leaving apply attempt queued; managed install/current is not active yet");
            return;
        }
        const marked = markPreparedUpdateInFlight(repos, prepared.operationId);
        if (!marked) {
            throw new Error("update_attempt_not_queued");
        }
        const child = spawn(prepared.switcherPath, [], {
            detached: true,
            stdio: "ignore",
            env: process.env,
        });
        child.unref();
        void gracefulShutdown(`update:${prepared.operationId}`);
    }
    catch (err) {
        releaseUpdateLock(loadEffectiveConfig(), prepared.operationId);
        repos.upsertUpdateAttempt({
            operationId: prepared.operationId,
            kind: "apply",
            status: "failed-no-rollback",
            errorMessage: err.message,
            completedAt: Date.now(),
            metadataJson: JSON.stringify({
                switcherPath: prepared.switcherPath,
                metadataPath: prepared.metadataPath,
                failedDuring: "engine_handoff",
            }),
        });
        console.error(`[update] apply execution handoff failed: ${err.message}`);
    }
}
// `itemActions` emits `item_column_changed` directly — it doesn't touch
// `stage_logs`. Lifecycle events (run_started, stage_started, …) are handled
// by the board stream's log tail instead; having two origins for the same
// event was the dedup bug we removed before.
itemActions.on("event", (ev) => {
    if (ev.type === "item_column_changed") {
        board.broadcastItemColumnChanged({
            itemId: ev.itemId,
            from: ev.from,
            to: ev.to,
            phaseStatus: ev.phaseStatus,
        });
    }
});
function loadEffectiveConfig() {
    const overrides = resolveOverrides();
    return resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides)
        ?? defaultAppConfig();
}
seedIfEmpty(db, repos);
// On every fresh process start, any run still in status='running' has no live
// worker — the previous process died mid-flight. Mark them failed so
// POST /runs/:id/resume accepts them without a manual DB patch.
try {
    await markOrphanedRunsFailed(repos);
}
catch (err) {
    console.error("[orphanRecovery] startup scan failed:", err.message);
}
pruneMissingWorktreeAssignments();
function attachRouteContext(req, appConfig) {
    req.repos = repos;
    req.appConfig = appConfig;
    req.executePreparedApply = startPreparedApplyExecution;
}
function topLevelRouteHandlers(context) {
    return {
        "GET /runs": () => handleListRuns(repos, context.res),
        "POST /runs": () => handleCreateRun(repos, context.req, context.res, payload => board.broadcastItemColumnChanged(payload)),
        "GET /board": () => handleGetBoard(db, context.url, context.res),
        "GET /setup/status": () => handleSetupStatus(context.url, context.res),
        "GET /update/status": () => handleUpdateStatus(repos, context.appConfig, context.res, { pid: process.pid }),
        "GET /update/preflight": () => handleUpdatePreflight(repos, context.appConfig, context.res, { pid: process.pid }),
        "POST /update/check": () => handleUpdateCheck(context.req, context.res),
        "POST /update/apply": () => handleUpdateApply(context.req, context.res),
        "GET /update/history": () => handleUpdateHistory(repos, context.appConfig, context.res),
        "POST /update/rollback": () => json(context.res, 409, {
            error: "post-migration-rollback-unsupported",
            code: "post-migration-rollback-unsupported",
        }),
        "POST /update/shutdown": () => handleUpdateShutdown(context.req, context.res, {
            requestShutdown: operationId => void gracefulShutdown(`update:${operationId}`)
        }),
        "GET /events": () => board.handle(context.req, context.res),
        "GET /health": () => json(context.res, 200, { ok: true }),
    };
}
function itemRouteMatchers(context) {
    return [
        { pattern: /^\/items\/([^/]+)\/actions\/([^/]+)$/, method: "POST", handle: (itemId, action) => handleItemActionNamed(itemActions, repos, context.req, context.res, itemId, action, payload => board.broadcastItemColumnChanged(payload)) },
        { pattern: /^\/items\/([^/]+)\/wireframes$/, method: "GET", handle: itemId => handleGetItemWireframes(repos, context.res, itemId) },
        { pattern: /^\/items\/([^/]+)\/design$/, method: "GET", handle: itemId => handleGetItemDesign(repos, context.res, itemId) },
        { pattern: /^\/items\/([^/]+)\/preview\/start$/, method: "POST", handle: itemId => handleStartItemPreview(repos, context.req, context.res, itemId) },
        { pattern: /^\/items\/([^/]+)\/preview\/stop$/, method: "POST", handle: itemId => handleStopItemPreview(repos, context.req, context.res, itemId) },
        { pattern: /^\/items\/([^/]+)\/preview$/, method: "GET", handle: itemId => handleGetItemPreview(repos, context.res, itemId) },
        { pattern: /^\/items\/([^/]+)$/, method: "GET", handle: itemId => handleGetItem(repos, context.res, itemId) },
    ];
}
function runRouteMatchers(context) {
    return [
        { pattern: /^\/runs\/([^/]+)\/artifacts\/(.+)$/, method: "GET", handle: (runId, artifactPath) => handleGetArtifactFile(repos, context.res, runId, artifactPath) },
        { pattern: /^\/runs\/([^/]+)\/artifacts$/, method: "GET", handle: runId => handleGetArtifacts(repos, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)$/, method: "GET", handle: runId => handleGetRun(repos, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/tree$/, method: "GET", handle: runId => handleGetRunTree(repos, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/events$/, method: "GET", handle: runId => handleRunEvents(repos, context.req, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/messages$/, method: "GET", handle: runId => handleGetMessages(repos, context.url, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/messages$/, method: "POST", handle: runId => handlePostMessage(repos, context.req, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/conversation$/, method: "GET", handle: runId => handleGetConversation(repos, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/answer$/, method: "POST", handle: runId => handleAnswer(repos, context.req, context.res, runId) },
        { pattern: /^\/runs\/([^/]+)\/resume$/, method: "POST", handle: runId => handleResumeRun(repos, context.req, context.res, runId, payload => board.broadcastItemColumnChanged(payload)) },
        { pattern: /^\/runs\/([^/]+)\/recovery$/, method: "GET", handle: runId => handleGetRecovery(repos, context.res, runId) },
    ];
}
function handleRouteMatchers(context, matchers) {
    for (const matcher of matchers) {
        if (context.req.method !== matcher.method)
            continue;
        const match = matcher.pattern.exec(context.path);
        if (!match)
            continue;
        matcher.handle(...match.slice(1));
        return true;
    }
    return false;
}
async function handlePreCsrfRoutes(context) {
    if (context.path !== "/webhooks/telegram" || context.req.method !== "POST")
        return false;
    handleTelegramChatToolWebhook(repos, context.appConfig, context.req, context.res);
    return true;
}
async function handleTopLevelRoutes(context) {
    const handler = topLevelRouteHandlers(context)[`${context.req.method} ${context.path}`];
    if (handler) {
        handler();
        return true;
    }
    if (context.path === "/openapi.json" && context.req.method === "GET") {
        const body = loadOpenApi();
        if (!body) {
            json(context.res, 503, { error: "openapi_unavailable", code: "service_unavailable" });
            return true;
        }
        context.res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        context.res.end(body);
        return true;
    }
    return false;
}
async function handleNotificationRoutes(context) {
    const notificationTestMatch = /^\/notifications\/test\/([^/]+)$/.exec(context.path);
    if (notificationTestMatch && context.req.method === "POST") {
        handleNotificationTest(repos, loadEffectiveConfig, context.res, notificationTestMatch[1]);
        return true;
    }
    if (context.path === "/notifications/deliveries" && context.req.method === "GET") {
        handleNotificationDeliveries(repos, context.url, context.res);
        return true;
    }
    return false;
}
async function handleWorkspaceRoutes(context) {
    const { path, req, res, url } = context;
    if (path === "/workspaces/preview" && req.method === "GET") {
        handleWorkspacePreview(repos, loadEffectiveConfig, url, res);
        return true;
    }
    if (path === "/workspaces" && req.method === "GET") {
        handleWorkspaceList(repos, res);
        return true;
    }
    if (path === "/workspaces" && req.method === "POST") {
        handleWorkspaceAdd(repos, loadEffectiveConfig, req, res);
        return true;
    }
    if (path === "/workspaces/backfill" && req.method === "POST") {
        handleWorkspaceBackfill(repos, res);
        return true;
    }
    const workspaceMatch = /^\/workspaces\/([^/]+)(?:\/(open))?$/.exec(path);
    if (!workspaceMatch)
        return false;
    const [, key, sub] = workspaceMatch;
    if (!sub && req.method === "GET") {
        handleWorkspaceGet(repos, res, key);
        return true;
    }
    if (!sub && req.method === "DELETE") {
        handleWorkspaceRemove(repos, loadEffectiveConfig, url, res, key);
        return true;
    }
    if (sub === "open" && req.method === "POST") {
        handleWorkspaceOpen(repos, res, key);
        return true;
    }
    return false;
}
async function handleItemRoutes(context) {
    if (context.path === "/items" && context.req.method === "GET") {
        handleListItems(repos, context.url, context.res);
        return true;
    }
    return handleRouteMatchers(context, itemRouteMatchers(context));
}
async function handleRunRoutes(context) {
    return handleRouteMatchers(context, runRouteMatchers(context));
}
const server = createServer(async (req, res) => {
    if (!req.url || !req.method)
        return json(res, 400, { error: "bad request" });
    setCors(res, req, ALLOWED_ORIGIN);
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const appConfig = loadEffectiveConfig();
    attachRouteContext(req, appConfig);
    const context = { req, res, url, path, appConfig };
    // Inbound webhooks authenticate via a channel-specific secret header
    // (Telegram sends `x-telegram-bot-api-secret-token`), not the engine's
    // CSRF token. Route them before the CSRF gate.
    if (await handlePreCsrfRoutes(context))
        return;
    if (!requireCsrfToken(req, API_TOKEN)) {
        return json(res, 403, { error: "csrf_token_required" });
    }
    try {
        if (await handleTopLevelRoutes(context))
            return;
        if (await handleNotificationRoutes(context))
            return;
        if (await handleWorkspaceRoutes(context))
            return;
        if (await handleItemRoutes(context))
            return;
        if (await handleRunRoutes(context))
            return;
        json(res, 404, { error: "not found" });
    }
    catch (err) {
        console.error("[api]", err);
        json(res, 500, { error: err.message });
    }
});
server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});
async function gracefulShutdown(reason) {
    if (shutdownInFlight)
        return;
    shutdownInFlight = true;
    console.error(`[engine] graceful shutdown requested: ${reason}`);
    server.close(async (closeErr) => {
        if (closeErr)
            console.error("[engine] server close error:", closeErr.message);
        try {
            db.pragma("wal_checkpoint(TRUNCATE)");
        }
        catch (err) {
            console.error("[engine] wal checkpoint during shutdown failed:", err.message);
        }
        try {
            db.close();
        }
        catch (err) {
            console.error("[engine] db close during shutdown failed:", err.message);
        }
        removeEnginePidFile();
        process.exit(closeErr ? 1 : 0);
    });
    setTimeout(() => {
        sockets.forEach(socket => socket.destroy());
    }, 10_000).unref();
}
process.on("SIGTERM", () => void gracefulShutdown("sigterm"));
process.on("SIGINT", () => void gracefulShutdown("sigint"));
server.listen(PORT, HOST, () => {
    console.log(`beerengineer_ engine listening on http://${HOST}:${PORT}`);
    const pidPath = writeEnginePidFile({
        pid: process.pid,
        host: HOST,
        port: PORT,
        startedAt: new Date().toISOString(),
    });
    console.error(`[engine] wrote pid file to ${pidPath}`);
    if (!API_TOKEN_WAS_PROVIDED) {
        const tokenPath = writeApiTokenFile(API_TOKEN);
        console.error(`[engine] BEERENGINEER_API_TOKEN=${API_TOKEN}`);
        console.error(`[engine] wrote token to ${tokenPath}`);
    }
});

import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import {
  buildUpdateStatus,
  listBackupHistory,
  listUpdateHistory,
  prepareUpdateApply,
  readUpdateLock,
  replayPreparedUpdateApply,
  runUpdateCheck,
  type UpdateApplyResult,
} from "../../core/updateMode.js"
import { readJson, json } from "../http.js"
import { join } from "node:path"

export function handleUpdateStatus(
  repos: Repos,
  config: AppConfig,
  res: ServerResponse,
  opts: { pid?: number | null } = {},
): void {
  json(res, 200, buildUpdateStatus(repos, config, opts))
}

export function handleUpdatePreflight(
  repos: Repos,
  config: AppConfig,
  res: ServerResponse,
  opts: { pid?: number | null } = {},
): void {
  json(res, 200, buildUpdateStatus(repos, config, opts).preflight)
}

export async function handleUpdateCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  for await (const _chunk of req) {
    // Drain the request body so callers can safely POST `{}`.
  }
  const operationId = randomUUID()
  try {
    const repos = (req as IncomingMessage & { repos?: Repos }).repos
    const config = (req as IncomingMessage & { appConfig?: AppConfig }).appConfig
    if (!repos || !config) throw new Error("update_check_failed:server_context_missing")
    const status = buildUpdateStatus(repos, config)
    const result = await runUpdateCheck(config, { bypassCache: true })
    repos.upsertUpdateAttempt({
      operationId,
      kind: "check",
      status: "succeeded",
      fromVersion: result.currentVersion,
      targetVersion: result.latestRelease.version,
      dbPath: status.dbPath,
      dbPathSource: status.dbPathSource,
      legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
      installRoot: status.install.root,
      metadataJson: JSON.stringify({ checkedAt: result.checkedAt, githubRepo: result.githubRepo }),
      completedAt: Date.now(),
    })
    json(res, 200, result)
  } catch (err) {
    const repos = (req as IncomingMessage & { repos?: Repos }).repos
    const config = (req as IncomingMessage & { appConfig?: AppConfig }).appConfig
    if (repos && config) {
      const status = buildUpdateStatus(repos, config)
      repos.upsertUpdateAttempt({
        operationId,
        kind: "check",
        status: "failed",
        fromVersion: status.currentVersion,
        dbPath: status.dbPath,
        dbPathSource: status.dbPathSource,
        legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
        installRoot: status.install.root,
        errorMessage: (err as Error).message,
        completedAt: Date.now(),
      })
    }
    json(res, 502, { error: (err as Error).message })
  }
}

export function handleUpdateHistory(repos: Repos, config: AppConfig, res: ServerResponse): void {
  json(res, 200, { attempts: listUpdateHistory(repos), backups: listBackupHistory(config) })
}

export async function handleUpdateApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { version?: string; allowLegacyDbShadow?: boolean }
  const repos = (req as IncomingMessage & { repos?: Repos }).repos
  const config = (req as IncomingMessage & { appConfig?: AppConfig }).appConfig
  const executePreparedApply = (req as IncomingMessage & {
    executePreparedApply?: (prepared: UpdateApplyResult) => void
  }).executePreparedApply
  if (!repos || !config) {
    json(res, 500, { error: "update_apply_failed:server_context_missing" })
    return
  }
  const idempotencyKeyHeader = req.headers["idempotency-key"]
  const idempotencyKey = typeof idempotencyKeyHeader === "string" && idempotencyKeyHeader.trim()
    ? idempotencyKeyHeader.trim()
    : null
  if (idempotencyKey) {
    const existing = repos.getUpdateAttemptByIdempotencyKey(idempotencyKey)
    const replay = existing ? replayPreparedUpdateApply(existing) : null
    if (replay) {
      json(res, 202, replay)
      return
    }
  }
  try {
    const result = await prepareUpdateApply(repos, config, {
      version: typeof body.version === "string" ? body.version : undefined,
      allowLegacyDbShadow: body.allowLegacyDbShadow === true,
      idempotencyKey: idempotencyKey ?? undefined,
    })
    json(res, 202, result)
    if (executePreparedApply) {
      setImmediate(() => executePreparedApply(result))
    }
  } catch (err) {
    const message = (err as Error).message
    const status = message.startsWith("update_preflight_failed:") || message === "update_lock_held" ? 409 : 500
    json(res, status, { error: message })
  }
}

export async function handleUpdateShutdown(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { requestShutdown: (operationId: string) => void },
): Promise<void> {
  const body = (await readJson(req)) as { operationId?: string }
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : ""
  if (!operationId) {
    json(res, 400, { error: "operation_id_required", code: "bad_request" })
    return
  }
  const config = (req as IncomingMessage & { appConfig?: AppConfig }).appConfig
  if (!config) {
    json(res, 500, { error: "config_unavailable" })
    return
  }
  const lock = readUpdateLock(join(config.dataDir, "update.lock"))
  if (!lock.held || lock.record?.operationId !== operationId) {
    json(res, 409, { error: "update_lock_mismatch", code: "update_lock_mismatch" })
    return
  }
  json(res, 202, { operationId, state: "shutting_down" })
  setImmediate(() => deps.requestShutdown(operationId))
}

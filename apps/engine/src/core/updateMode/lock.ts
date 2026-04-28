import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import type { AppConfig } from "../../setup/types.js"
import { safeReadJson } from "./shared.js"
import type { UpdateLockRecord, UpdateLockState } from "./types.js"

const STALE_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function updateLockPath(config: Pick<AppConfig, "dataDir">): string {
  return join(config.dataDir, "update.lock")
}

export function resolveUpdateLockFilePath(config: Pick<AppConfig, "dataDir">): string {
  return updateLockPath(config)
}

export function readUpdateLock(lockPath: string): UpdateLockState {
  if (!existsSync(lockPath)) return { held: false, stale: false, record: null }
  const parsed = safeReadJson<Partial<UpdateLockRecord>>(lockPath)
  if (!parsed) return { held: true, stale: false, record: null }
  const pid = typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : null
  const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : null
  const operationId = typeof parsed.operationId === "string" && parsed.operationId.trim()
    ? parsed.operationId.trim()
    : null
  const host = typeof parsed.host === "string" && parsed.host.trim() ? parsed.host.trim() : "unknown"
  let processMissing = false
  if (pid !== null) {
    try {
      process.kill(pid, 0)
    } catch {
      processMissing = true
    }
  }
  return {
    held: true,
    stale: processMissing || isStartedAtStale(startedAt),
    record: pid !== null && startedAt !== null && operationId
      ? { pid, startedAt, operationId, host }
      : null,
  }
}

export function acquireUpdateLock(
  config: Pick<AppConfig, "dataDir">,
  opts: { operationId?: string; pid?: number } = {},
): { path: string; record: UpdateLockRecord; reclaimed: boolean; reclaimedFrom: UpdateLockRecord | null } {
  const path = updateLockPath(config)
  mkdirSync(dirname(path), { recursive: true })
  const record: UpdateLockRecord = {
    operationId: opts.operationId ?? randomUUID(),
    pid: opts.pid ?? process.pid,
    startedAt: Date.now(),
    host: hostname(),
  }
  const write = (): void => {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  }
  try {
    write()
    return { path, record, reclaimed: false, reclaimedFrom: null }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw err
    const existing = readUpdateLock(path)
    if (!existing.stale) {
      throw new Error("update_lock_held")
    }
    try {
      unlinkSync(path)
    } catch {}
    write()
    return { path, record, reclaimed: true, reclaimedFrom: existing.record }
  }
}

export function releaseUpdateLock(config: Pick<AppConfig, "dataDir">, operationId?: string): boolean {
  const path = updateLockPath(config)
  if (!existsSync(path)) return false
  if (operationId) {
    const existing = readUpdateLock(path)
    if (existing.record?.operationId && existing.record.operationId !== operationId) return false
  }
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function isStartedAtStale(startedAt: number | null): boolean {
  return startedAt !== null && Date.now() - startedAt > STALE_LOCK_MAX_AGE_MS
}

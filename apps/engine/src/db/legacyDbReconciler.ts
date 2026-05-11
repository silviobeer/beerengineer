import Database from "better-sqlite3"
import * as fs from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { getConfiguredDataDirOrNull } from "../setup/config.js"

export type LegacyDbCleanupOutcome =
  | "not-applicable"
  | "cleaned"
  | "skipped-no-configured-db"
  | "skipped-non-empty"
  | "skipped-unreadable"
  | "failed-deletion"

type ReconciliationState = {
  cacheKey: string
  configuredDbPath: string
  legacyDbPath: string
  outcome: LegacyDbCleanupOutcome
}

let cachedState: ReconciliationState | null = null

export function resolveLegacyDbPath(): string {
  return resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")
}

export function resolveLegacyDbCleanupLogPath(dataDir: string): string {
  return join(dataDir, "logs", "legacy-db-cleanup.jsonl")
}

export function getLegacyDbReconciliationState():
  | Pick<ReconciliationState, "cacheKey" | "configuredDbPath" | "legacyDbPath" | "outcome">
  | null {
  const configuredDataDir = getConfiguredDataDirOrNull()
  if (configuredDataDir == null) return null

  const configuredDbPath = resolve(configuredDataDir, "beerengineer.sqlite")
  const legacyDbPath = resolveLegacyDbPath()
  if (configuredDbPath === legacyDbPath) return null
  if (fs.existsSync(legacyDbPath) === false) return null

  const cacheKey = `${configuredDbPath}::${legacyDbPath}`
  if (cachedState?.cacheKey === cacheKey) return cachedState
  return {
    cacheKey,
    configuredDbPath,
    legacyDbPath,
    outcome: "not-applicable",
  }
}

export function ensureLegacyDbReconciled(): LegacyDbCleanupOutcome {
  const state = getLegacyDbReconciliationState()
  if (state == null) return "not-applicable"
  if (state.outcome !== "not-applicable") return state.outcome

  let outcome: Exclude<LegacyDbCleanupOutcome, "not-applicable">
  if (fs.existsSync(state.configuredDbPath)) {
    outcome = inspectAndMaybeDeleteLegacyDb(state.legacyDbPath)
  } else {
    outcome = "skipped-no-configured-db"
  }

  appendCleanupEvent({
    configuredDbPath: state.configuredDbPath,
    legacyDbPath: state.legacyDbPath,
    outcome,
  })
  cachedState = { ...state, outcome }
  return outcome
}

export function legacyDbShadowRequiresWarning(): boolean {
  const state = getLegacyDbReconciliationState()
  if (state == null) return false
  return state.outcome !== "cleaned"
}

function inspectAndMaybeDeleteLegacyDb(legacyDbPath: string): Exclude<LegacyDbCleanupOutcome, "not-applicable"> {
  let db: Database.Database | null = null
  try {
    db = new Database(legacyDbPath, { readonly: true, fileMustExist: true })
    const itemCount = countRows(db, "items")
    const runCount = countRows(db, "runs")
    if (itemCount > 0 || runCount > 0) return "skipped-non-empty"
  } catch {
    return "skipped-unreadable"
  } finally {
    db?.close()
  }

  return deleteLegacyDbFamily(legacyDbPath)
}

function countRows(db: Database.Database, tableName: "items" | "runs"): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | undefined
  return Number(row?.count ?? 0)
}

function deleteLegacyDbFamily(legacyDbPath: string): Exclude<LegacyDbCleanupOutcome, "not-applicable"> {
  const targets = [
    `${legacyDbPath}-wal`,
    `${legacyDbPath}-shm`,
    legacyDbPath,
  ].filter(path => fs.existsSync(path))
  const backups = targets.map((target, index) => ({
    target,
    backup: `${target}.beerengineer-cleanup-backup-${process.pid}-${Date.now()}-${index}`,
  }))

  try {
    for (const { target, backup } of backups) fs.copyFileSync(target, backup)
  } catch {
    cleanupBackups(backups)
    return "failed-deletion"
  }

  try {
    for (const { target } of backups) fs.rmSync(target)
    if (backups.some(({ target }) => fs.existsSync(target))) throw new Error("legacy_cleanup_incomplete")
  } catch {
    restoreTargets(backups)
    cleanupBackups(backups)
    return "failed-deletion"
  }

  cleanupBackups(backups)
  return "cleaned"
}

function cleanupBackups(backups: Array<{ backup: string }>): void {
  for (const { backup } of backups) {
    if (fs.existsSync(backup)) {
      try {
        fs.rmSync(backup, { force: true })
      } catch {
        // Best-effort only; the cleanup verdict is determined by the original family.
      }
    }
  }
}

function restoreTargets(backups: Array<{ target: string; backup: string }>): void {
  for (const { target, backup } of backups) {
    if (fs.existsSync(target) === false && fs.existsSync(backup)) {
      try {
        fs.copyFileSync(backup, target)
      } catch {
        // Best-effort only. The shadow remains unresolved either way.
      }
    }
  }
}

function appendCleanupEvent(input: {
  configuredDbPath: string
  legacyDbPath: string
  outcome: Exclude<LegacyDbCleanupOutcome, "not-applicable">
}): void {
  const logPath = resolveLegacyDbCleanupLogPath(dirname(input.configuredDbPath))
  fs.mkdirSync(dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, `${JSON.stringify({
    event: "legacy-db-cleanup",
    configuredDbPath: input.configuredDbPath,
    legacyDbPath: input.legacyDbPath,
    outcome: input.outcome,
    timestamp: new Date().toISOString(),
  })}\n`, "utf8")
}

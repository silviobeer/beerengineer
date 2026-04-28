import Database from "better-sqlite3"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ResolvedDbPathInfo } from "../../db/connection.js"
import type { AppConfig } from "../../setup/types.js"
import { resolveManagedInstallPaths, safeReadJson, sha256File } from "./shared.js"
import type { DatabaseBackupRecord } from "./types.js"

const BACKUP_RETENTION_COUNT = 5

export function createDatabaseBackup(
  config: Pick<AppConfig, "dataDir">,
  opts: {
    operationId: string
    fromVersion: string
    targetVersion: string
    db: ResolvedDbPathInfo
  },
): DatabaseBackupRecord {
  const install = resolveManagedInstallPaths(config)
  mkdirSync(install.backupRoot, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const backupDir = join(install.backupRoot, `${stamp}-${opts.fromVersion}-to-${opts.targetVersion}`)
  mkdirSync(backupDir, { recursive: true })

  const checkpointDb = new Database(opts.db.path, { fileMustExist: true })
  try {
    checkpointDb.pragma("wal_checkpoint(TRUNCATE)")
  } finally {
    checkpointDb.close()
  }

  const files: Array<{ name: string; bytes: number }> = []
  for (const name of ["beerengineer.sqlite", "beerengineer.sqlite-wal", "beerengineer.sqlite-shm"]) {
    let src = opts.db.path
    if (name !== "beerengineer.sqlite") src = `${opts.db.path}${name.slice("beerengineer.sqlite".length)}`
    if (!existsSync(src)) continue
    const dest = join(backupDir, name)
    copyFileSync(src, dest)
    files.push({ name, bytes: readFileSync(dest).byteLength })
  }

  const sqliteSha256 = sha256File(join(backupDir, "beerengineer.sqlite"))
  const manifest: DatabaseBackupRecord = {
    backupDir,
    sourceDbPath: opts.db.path,
    sourceDbPathSource: opts.db.source,
    createdAt: new Date().toISOString(),
    fromVersion: opts.fromVersion,
    targetVersion: opts.targetVersion,
    operationId: opts.operationId,
    sqliteSha256,
    files,
  }
  writeFileSync(backupManifestPath(backupDir), `${JSON.stringify({
    sourceDbPath: manifest.sourceDbPath,
    sourceDbPathSource: manifest.sourceDbPathSource,
    createdAt: manifest.createdAt,
    fromVersion: manifest.fromVersion,
    targetVersion: manifest.targetVersion,
    operationId: manifest.operationId,
    sqliteSha256: manifest.sqliteSha256,
    files: manifest.files,
  }, null, 2)}\n`, "utf8")
  pruneBackupRetention(install.backupRoot, backupDir)
  return manifest
}

export function readLatestBackup(backupRoot: string): DatabaseBackupRecord | null {
  return listDatabaseBackups(backupRoot, 1)[0] ?? null
}

export function listBackupHistory(config: Pick<AppConfig, "dataDir">, limit = 20): DatabaseBackupRecord[] {
  return listDatabaseBackups(resolveManagedInstallPaths(config).backupRoot, limit)
}

function backupManifestPath(dir: string): string {
  return join(dir, "manifest.json")
}

function readBackupManifest(dir: string): DatabaseBackupRecord | null {
  const parsed = safeReadJson<Omit<DatabaseBackupRecord, "backupDir">>(backupManifestPath(dir))
  if (!parsed) return null
  return { ...parsed, backupDir: dir }
}

function listDatabaseBackups(backupRoot: string, limit = 20): DatabaseBackupRecord[] {
  if (!existsSync(backupRoot)) return []
  const backups = readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readBackupManifest(join(backupRoot, entry.name)))
    .filter((entry): entry is DatabaseBackupRecord => entry !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return backups.slice(0, Math.max(1, limit))
}

function pruneBackupRetention(backupRoot: string, currentBackupDir: string): void {
  if (!existsSync(backupRoot)) return
  const backups = readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readBackupManifest(join(backupRoot, entry.name)))
    .filter((entry): entry is DatabaseBackupRecord => entry !== null)
    .filter(entry => entry.backupDir !== currentBackupDir)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  backups.slice(BACKUP_RETENTION_COUNT - 1).forEach(entry => {
    rmSync(entry.backupDir, { recursive: true, force: true })
  })
}

import Database from "better-sqlite3"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { REQUIRED_MIGRATION_LEVEL } from "../setup/config.js"

export type Db = Database.Database

const defaultDbPath = () => resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")

export function resolveDbPath(override?: string | null): string {
  return override ?? process.env.BEERENGINEER_UI_DB_PATH ?? defaultDbPath()
}

export function openDatabase(dbPath?: string | null): Db {
  const p = resolveDbPath(dbPath)
  mkdirSync(dirname(p), { recursive: true })
  const db = new Database(p)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  return db
}

export function applySchema(db: Db): void {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url))
  const sql = readFileSync(schemaPath, "utf8")
  db.exec(sql)
  migrateRunsOwnerColumn(db)
  migrateRunsRecoveryColumns(db)
  db.pragma(`user_version = ${REQUIRED_MIGRATION_LEVEL}`)
}

export function initDatabase(dbPath?: string | null): Db {
  const db = openDatabase(dbPath)
  applySchema(db)
  return db
}

/**
 * Add the `owner` column to an older `runs` table that predates the CLI/API
 * split. Existing rows default to "api" because they were historically only
 * created by the HTTP server.
 */
function migrateRunsOwnerColumn(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
  if (cols.some(c => c.name === "owner")) return
  db.exec("ALTER TABLE runs ADD COLUMN owner TEXT NOT NULL DEFAULT 'api'")
}

/**
 * Add the recovery projection columns to an older `runs` table. New databases
 * pick these up from schema.sql directly; this branch keeps pre-existing local
 * DBs readable after upgrade.
 */
function migrateRunsRecoveryColumns(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
  const has = (name: string) => cols.some(c => c.name === name)
  if (!has("recovery_status")) db.exec("ALTER TABLE runs ADD COLUMN recovery_status TEXT")
  if (!has("recovery_scope")) db.exec("ALTER TABLE runs ADD COLUMN recovery_scope TEXT")
  if (!has("recovery_scope_ref")) db.exec("ALTER TABLE runs ADD COLUMN recovery_scope_ref TEXT")
  if (!has("recovery_summary")) db.exec("ALTER TABLE runs ADD COLUMN recovery_summary TEXT")
}

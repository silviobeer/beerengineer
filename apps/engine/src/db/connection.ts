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
  migrateWorkspacesColumns(db)
  migrateRunsOwnerColumn(db)
  migrateRunsRecoveryColumns(db)
  stampMigrationLevel(db)
}

// The idempotent ALTER TABLE migrations above bring any fresh or pre-1 DB to
// current shape. Only stamp user_version when we're at or below the level we
// know how to produce; leave higher levels untouched so a newer binary opening
// an older DB doesn't appear to downgrade.
// TODO: when introducing level 2+, switch to a real migrate(from, to) runner
// keyed off the current user_version rather than unconditionally running every
// idempotent helper.
function stampMigrationLevel(db: Db): void {
  const current = (db.pragma("user_version", { simple: true }) as number) ?? 0
  if (current < REQUIRED_MIGRATION_LEVEL) {
    db.pragma(`user_version = ${REQUIRED_MIGRATION_LEVEL}`)
  }
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

function migrateWorkspacesColumns(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>
  const has = (name: string) => cols.some(c => c.name === name)
  if (!has("harness_profile_json")) {
    db.exec(`ALTER TABLE workspaces ADD COLUMN harness_profile_json TEXT NOT NULL DEFAULT '{"mode":"claude-first"}'`)
  }
  if (!has("sonar_enabled")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN sonar_enabled INTEGER NOT NULL DEFAULT 0")
  }
  if (!has("last_opened_at")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN last_opened_at INTEGER")
  }
}

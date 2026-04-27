import Database from "better-sqlite3"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { REQUIRED_MIGRATION_LEVEL, getConfiguredDataDirOrNull } from "../setup/config.js"

export type Db = Database.Database

const legacyDbPath = () => resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")

/**
 * Resolve the SQLite database path using a four-tier priority order:
 *
 *   1. Explicit `override` argument — used by tests and direct callers.
 *   2. `BEERENGINEER_UI_DB_PATH` environment variable.
 *   3. `dataDir` from the on-disk setup config (`~/.config/beerengineer-nodejs/config.json`
 *      on Linux, or wherever `env-paths` places it).
 *   4. Legacy hard-coded `~/.local/share/beerengineer/beerengineer.sqlite` — emits a
 *      warning to stderr so the user knows to run `beerengineer setup`.
 *
 * When tier 3 is used and the legacy DB file also exists the function emits an
 * ambiguity warning but does not auto-migrate — that is a manual decision.
 */
export function resolveDbPath(override?: string | null): string {
  // Tier 1: explicit override (tests inject a tmp path here).
  if (override != null) return override

  // Tier 2: env var (used by some test harnesses and the UI server).
  if (process.env.BEERENGINEER_UI_DB_PATH) return process.env.BEERENGINEER_UI_DB_PATH

  // Tier 3: read the setup config that `beerengineer setup` writes.
  const configuredDataDir = getConfiguredDataDirOrNull()
  if (configuredDataDir != null) {
    const configuredDb = resolve(configuredDataDir, "beerengineer.sqlite")
    const legacy = legacyDbPath()
    // Warn when both files exist so the user knows they may be looking at stale data.
    if (existsSync(configuredDb) && existsSync(legacy) && configuredDb !== legacy) {
      process.stderr.write(
        `[engine] WARNING: both the configured DB (${configuredDb}) and the legacy DB (${legacy}) exist. ` +
        `The engine will use the configured path. If you have data in the legacy location, ` +
        `copy it manually before removing the old file.\n`,
      )
    }
    return configuredDb
  }

  // Tier 4: no config found — fall back to the legacy hard-coded path.
  process.stderr.write(
    "[engine] db path fell back to legacy location — run beerengineer setup\n",
  )
  return legacyDbPath()
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
  migrateRunsFsWorkspaceIdColumn(db)
  migrateStageRunsSessionColumns(db)
  migrateNotificationDeliveriesTable(db)
  migrateItemsCurrentStageColumn(db)
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

/**
 * Add `workspace_fs_id` — the on-disk workspace directory name the engine
 * derives from the item title. Persisted so resume doesn't have to re-derive
 * it from the (mutable) title or scan every workspace dir.
 */
function migrateRunsFsWorkspaceIdColumn(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
  if (cols.some(c => c.name === "workspace_fs_id")) return
  db.exec("ALTER TABLE runs ADD COLUMN workspace_fs_id TEXT")
}

function migrateStageRunsSessionColumns(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(stage_runs)").all() as Array<{ name: string }>
  const has = (name: string) => cols.some(c => c.name === name)
  if (!has("stage_agent_session_id")) db.exec("ALTER TABLE stage_runs ADD COLUMN stage_agent_session_id TEXT")
  if (!has("reviewer_session_id")) db.exec("ALTER TABLE stage_runs ADD COLUMN reviewer_session_id TEXT")
}

function migrateNotificationDeliveriesTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      dedup_key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      delivered_at INTEGER,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  const cols = db.prepare("PRAGMA table_info(notification_deliveries)").all() as Array<{ name: string }>
  const has = (name: string) => cols.some(c => c.name === name)
  if (!has("run_id")) db.exec("ALTER TABLE notification_deliveries ADD COLUMN run_id TEXT")
  if (!has("prompt_id")) db.exec("ALTER TABLE notification_deliveries ADD COLUMN prompt_id TEXT")
  if (!has("telegram_message_id")) db.exec("ALTER TABLE notification_deliveries ADD COLUMN telegram_message_id INTEGER")
  if (!has("expires_at")) db.exec("ALTER TABLE notification_deliveries ADD COLUMN expires_at INTEGER")

  db.exec(`
    CREATE INDEX IF NOT EXISTS notification_deliveries_channel_created_idx
    ON notification_deliveries(channel, created_at)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS notification_deliveries_telegram_msg_idx
    ON notification_deliveries(channel, chat_id, telegram_message_id)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS notification_deliveries_run_prompt_idx
    ON notification_deliveries(run_id, prompt_id)
  `)
}

/**
 * Add `current_stage` to an older `items` table. The board mini-stepper reads
 * this directly; null means "no live stage". Authoritative writes only — see
 * runOrchestrator's isAuthoritative gate.
 */
function migrateItemsCurrentStageColumn(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>
  if (cols.some(c => c.name === "current_stage")) return
  db.exec("ALTER TABLE items ADD COLUMN current_stage TEXT")
}

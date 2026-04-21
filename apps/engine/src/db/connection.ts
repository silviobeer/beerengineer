import Database from "better-sqlite3"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

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
}

export function initDatabase(dbPath?: string | null): Db {
  const db = openDatabase(dbPath)
  applySchema(db)
  return db
}

import Database from "better-sqlite3"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"

const fixtureDbPath = resolve(__dirname, "..", ".tmp", "board-e2e.sqlite")
const schemaPath = resolve(__dirname, "..", "..", "..", "engine", "src", "db", "schema.sql")

export default async function globalSetup() {
  rmSync(fixtureDbPath, { force: true })
  rmSync(`${fixtureDbPath}-wal`, { force: true })
  rmSync(`${fixtureDbPath}-shm`, { force: true })

  mkdirSync(dirname(fixtureDbPath), { recursive: true })
  const db = new Database(fixtureDbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.exec(readFileSync(schemaPath, "utf8"))

  const now = () => Date.now()
  const insertWorkspace = db.prepare(
    "INSERT INTO workspaces (id, key, name, description, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)"
  )
  const insertItem = db.prepare(
    "INSERT INTO items (id, workspace_id, code, title, description, current_column, phase_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )

  const mkWs = (key: string, name: string, description: string) => {
    const id = randomUUID()
    insertWorkspace.run(id, key, name, description, now(), now())
    return id
  }

  const alpha = mkWs("alpha", "Alpha Workspace", "Primary delivery scope")
  const beta = mkWs("beta", "Beta Workspace", "Secondary validation scope")
  mkWs("empty", "Empty Workspace", "No persisted items yet")
  mkWs("broken", "Broken Workspace", "Used to simulate a live-data failure state")

  const mkItem = (
    workspaceId: string,
    code: string,
    title: string,
    description: string,
    column: "idea" | "brainstorm" | "requirements" | "implementation" | "done",
    status: "draft" | "running" | "review_required" | "completed" | "failed"
  ) => {
    insertItem.run(randomUUID(), workspaceId, code, title, description, column, status, now(), now())
  }

  mkItem(alpha, "ITEM-0001", "Live board shell integration", "Server-side board view backed by real workspace items.", "idea", "draft")
  mkItem(alpha, "ITEM-0002", "Live read adapter hardening", "Wire the UI shell to persisted workflow state without fixture cards.", "implementation", "failed")
  mkItem(beta, "ITEM-0003", "Release readiness verification", "Secondary workspace proves board data re-scopes when the active workspace changes.", "done", "completed")

  db.close()
}

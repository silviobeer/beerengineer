import type { Db } from "../db/connection.js"
import { Repos, type ItemRow } from "../db/repositories.js"

/**
 * Optional dev convenience: when BEERENGINEER_SEED=1 (default for local
 * dev) insert a demo workspace + cards so a fresh DB renders something.
 * Tests must leave this off (or pass BEERENGINEER_SEED=0) so they get a
 * clean slate.
 */
export function seedIfEmpty(db: Db, repos: Repos): void {
  if (process.env.BEERENGINEER_SEED === "0") return
  if (!process.env.BEERENGINEER_SEED && process.env.NODE_ENV === "test") return
  const count = (db.prepare("SELECT COUNT(*) as c FROM workspaces").get() as { c: number }).c
  if (count > 0) return
  const ws = repos.upsertWorkspace({
    key: "alpha",
    name: "Alpha Workspace",
    description: "Primary delivery scope",
  })
  const samples: Array<{
    title: string
    description: string
    column: ItemRow["current_column"]
    phase: ItemRow["phase_status"]
  }> = [
    { title: "Live board shell integration", description: "Server-side board view backed by real workspace items.", column: "idea", phase: "draft" },
    { title: "Engine event stream", description: "SSE pipe from workflow engine to board UI.", column: "brainstorm", phase: "running" },
    { title: "Prompt handoff wiring", description: "Allow the UI to answer engine prompts without the CLI.", column: "implementation", phase: "running" },
    { title: "Welcome tour", description: "Guided overlay for first-time operators.", column: "done", phase: "completed" },
  ]
  for (const s of samples) {
    const it = repos.createItem({ workspaceId: ws.id, title: s.title, description: s.description })
    repos.setItemColumn(it.id, s.column, s.phase)
  }
}

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { applySchema, openDatabase, resolveDbPath } from "../db/connection.js"
import { previewUrlForPort } from "./previewHost.js"

type Pool = { start: number; end: number }

type AssignmentRow = {
  worktree_path: string
  branch: string
  port: number
  created_at: number
}

const DEFAULT_POOL = "3200-3399"
const schemaReadyDbPaths = new Set<string>()

export class WorktreePortPoolExhaustedError extends Error {
  constructor() {
    super("worktree_port_pool_exhausted")
    this.name = "WorktreePortPoolExhaustedError"
  }
}

export function isWorktreePortPoolExhaustedError(error: unknown): error is WorktreePortPoolExhaustedError {
  return error instanceof WorktreePortPoolExhaustedError ||
    ((error as { message?: unknown })?.message === "worktree_port_pool_exhausted")
}

function parsePool(raw: string): Pool {
  const match = /^(\d+)-(\d+)$/.exec(raw.trim())
  if (!match) return parsePool(DEFAULT_POOL)
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return parsePool(DEFAULT_POOL)
  }
  return { start, end }
}

function readWorkspacePool(workspaceRoot?: string): Pool {
  if (workspaceRoot) {
    try {
      const raw = readFileSync(resolve(workspaceRoot, ".beerengineer", "workspace.json"), "utf8")
      const parsed = JSON.parse(raw) as { worktreePortPool?: { start?: unknown; end?: unknown } }
      const start = Number(parsed.worktreePortPool?.start)
      const end = Number(parsed.worktreePortPool?.end)
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
        return { start, end }
      }
    } catch {
      // fall through to env/default
    }
  }
  return parsePool(process.env.BEERENGINEER_WORKTREE_PORT_POOL?.trim() || DEFAULT_POOL)
}

function hashBranch(branch: string): number {
  let hash = 0
  for (let i = 0; i < branch.length; i++) {
    hash = ((hash << 5) - hash + branch.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function assignPort(worktreePath: string, branch: string, workspaceRoot?: string): number {
  const dbPath = resolveDbPath()
  const db = openDatabase(dbPath)
  try {
    if (!schemaReadyDbPaths.has(dbPath)) {
      applySchema(db)
      schemaReadyDbPaths.add(dbPath)
    }
    const pool = readWorkspacePool(workspaceRoot)
    const size = pool.end - pool.start + 1
    const path = resolve(worktreePath)
    const txn = db.transaction(() => {
      const existing = db.prepare("SELECT * FROM worktree_port_assignments WHERE worktree_path = ?").get(path) as AssignmentRow | undefined
      if (existing) return existing.port

      const insert = db.prepare(
        "INSERT INTO worktree_port_assignments (worktree_path, branch, port, created_at) VALUES (?, ?, ?, ?)",
      )
      const offset = hashBranch(branch) % size
      for (let i = 0; i < size; i++) {
        const port = pool.start + ((offset + i) % size)
        try {
          insert.run(path, branch, port, Date.now())
          return port
        } catch {
          // unique port collision, try next
        }
      }
      throw new WorktreePortPoolExhaustedError()
    })
    return txn()
  } finally {
    db.close()
  }
}

export function releasePort(worktreePath: string): void {
  const db = openDatabase()
  try {
    try {
      db.prepare("DELETE FROM worktree_port_assignments WHERE worktree_path = ?").run(resolve(worktreePath))
    } catch {
      // Older temp DBs in tests may not have run the migration yet.
    }
  } finally {
    db.close()
  }
}

export function lookupPort(worktreePath: string): number | null {
  const db = openDatabase()
  try {
    try {
      const row = db
        .prepare("SELECT port FROM worktree_port_assignments WHERE worktree_path = ?")
        .get(resolve(worktreePath)) as { port: number } | undefined
      return row?.port ?? null
    } catch {
      return null
    }
  } finally {
    db.close()
  }
}

export function previewUrlForWorktree(worktreePath: string): string | undefined {
  const port = lookupPort(worktreePath)
  return port ? previewUrlForPort(port) : undefined
}

export function pruneMissingWorktreeAssignments(): number {
  const db = openDatabase()
  try {
    let rows: Array<{ worktree_path: string }>
    try {
      rows = db.prepare("SELECT worktree_path FROM worktree_port_assignments").all() as Array<{ worktree_path: string }>
    } catch {
      return 0
    }
    let removed = 0
    const del = db.prepare("DELETE FROM worktree_port_assignments WHERE worktree_path = ?")
    for (const row of rows) {
      if (existsSync(row.worktree_path)) continue
      del.run(row.worktree_path)
      removed += 1
    }
    return removed
  } finally {
    db.close()
  }
}

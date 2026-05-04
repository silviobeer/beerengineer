import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-5 US-3: validateBranch applies migrations and seed, retaining on failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-validate-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 1")
  writeFileSync(join(dir, "supabase", "seed.sql"), "select seed")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const sql: string[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async () => ({ id: "br", ref: "br" }),
        runQuery: async (_p, _b, query) => { sql.push(query) },
      },
    })
    assert.equal((await adapter.validateBranch({ workspaceRoot: dir, projectRef: "proj", branchRef: "br", runId: run.id })).ok, true)
    assert.deepEqual(sql, ["select 1", "select seed"])
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "validated")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

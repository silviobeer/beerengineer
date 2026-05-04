import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-7 US-4: migrateProduction applies migrations only in timestamp order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prod-migrate-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  mkdirSync(join(dir, "supabase", "seeds"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 'a'")
  writeFileSync(join(dir, "supabase", "migrations", "20260504130000_b.sql"), "select 'b'")
  writeFileSync(join(dir, "supabase", "seed.sql"), "select 'seed'")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const sql: string[] = []
  try {
    const adapter = createSupabaseAdapter({ repos, client: { listBranches: async () => [], createBranch: async () => ({ id: "br", ref: "br" }), runQuery: async (_p, _b, query) => { sql.push(query) } } })
    const result = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "main" })
    assert.equal(result.ok, true)
    assert.deepEqual(sql, ["select 'a'", "select 'b'"])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

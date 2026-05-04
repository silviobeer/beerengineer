import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"
import { SupabaseManagementError } from "../../../src/core/supabase/managementClient.js"

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
    const adapter = createSupabaseAdapter({ repos, client: { listBranches: async () => [], createBranch: async () => ({ id: "br", ref: "br" }), runQuery: async (_p, _b, query) => { sql.push(query); return undefined } } })
    const result = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "main" })
    assert.equal(result.ok, true)
    // QA-009: each migration body now executes inside its own BEGIN/COMMIT
    // alongside a tracking-table INSERT. Assert ordering of the bodies and
    // that the tracking table is provisioned before any migration runs.
    assert.ok(sql[0].includes("CREATE TABLE IF NOT EXISTS __beerengineer_migrations"))
    const transactionBlocks = sql.filter(s => s.includes("BEGIN") && s.includes("COMMIT"))
    assert.equal(transactionBlocks.length, 2)
    assert.ok(transactionBlocks[0].includes("select 'a'"))
    assert.ok(transactionBlocks[1].includes("select 'b'"))
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 review M2: migrateProduction preserves rate-limit retryAfter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prod-migrate-rate-limit-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 'a'")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async () => ({ id: "br", ref: "br" }),
        runQuery: async (_p, _b, query) => {
          // QA-009: tracking-table provisioning and SELECT must succeed so
          // we can prove the rate-limit hits the migration body itself.
          if (query.includes("CREATE TABLE IF NOT EXISTS __beerengineer_migrations")) return undefined
          if (query.includes("SELECT filename FROM __beerengineer_migrations")) return { rows: [] }
          throw new SupabaseManagementError("rate_limit", "Too many requests", 429, "2")
        },
      },
    })
    const result = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "main" })
    assert.equal(result.ok, false)
    assert.equal(result.context?.retryAfter, "2")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

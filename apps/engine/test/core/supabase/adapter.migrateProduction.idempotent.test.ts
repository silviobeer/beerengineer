import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

/**
 * QA-009: migrateProduction must be idempotent + transactional. After a
 * partial failure the operator can re-run and only the missing files apply.
 *
 * Implementation contract:
 *   - On first run, a `__beerengineer_migrations` tracking table is ensured
 *     in the target Supabase project.
 *   - Each migration file is wrapped in a single BEGIN/COMMIT and ends with
 *     an INSERT into the tracking table — atomic per file.
 *   - On retry, files already recorded in the tracking table are skipped.
 */

type RunQueryCall = { branchRef: string; sql: string }

function fakeClient(opts: { failOnContains?: string } = {}) {
  const calls: RunQueryCall[] = []
  // Simulate the tracking table inside the fake DB, indexed per (project, branch).
  const tracked = new Set<string>()
  let trackingTableCreated = false

  return {
    calls,
    tracked,
    isTrackingTableCreated: () => trackingTableCreated,
    listBranches: async () => [],
    createBranch: async () => ({ id: "br", ref: "br" }),
    runQuery: async (_projectRef: string, branchRef: string, sql: string) => {
      calls.push({ branchRef, sql })
      // Tracking-table creation always succeeds (idempotent CREATE TABLE).
      if (sql.includes("CREATE TABLE IF NOT EXISTS __beerengineer_migrations")) {
        trackingTableCreated = true
        return undefined
      }
      // Fake "already-applied" lookup: SELECT filename FROM __beerengineer_migrations
      if (sql.includes("SELECT filename FROM __beerengineer_migrations")) {
        return { rows: Array.from(tracked).map(filename => ({ filename })) }
      }
      // Migration body wrapped in BEGIN ... INSERT ... COMMIT
      if (sql.includes("BEGIN") && sql.includes("INSERT INTO __beerengineer_migrations")) {
        // Extract filename from the INSERT
        const match = /INSERT INTO __beerengineer_migrations\s*\(\s*filename\s*\)\s*VALUES\s*\(\s*'([^']+)'\s*\)/.exec(sql)
        const filename = match?.[1] ?? ""
        if (opts.failOnContains && sql.includes(opts.failOnContains)) {
          // Simulate transaction rollback — nothing is recorded.
          throw new Error("simulated provider failure")
        }
        if (filename) tracked.add(filename)
        return undefined
      }
      return undefined
    },
  }
}

test("PROJ-4 QA-009: migrateProduction creates tracking table and records each applied file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-migrate-track-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 'a'")
  writeFileSync(join(dir, "supabase", "migrations", "20260504130000_b.sql"), "select 'b'")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const client = fakeClient()
    const adapter = createSupabaseAdapter({ repos, client })
    const result = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "production" })
    assert.equal(result.ok, true)
    assert.equal(client.isTrackingTableCreated(), true)
    assert.ok(client.tracked.has("supabase/migrations/20260504120000_a.sql"))
    assert.ok(client.tracked.has("supabase/migrations/20260504130000_b.sql"))
    // Each migration body should have run inside a BEGIN/COMMIT block.
    const migrationCalls = client.calls.filter(c => c.sql.includes("BEGIN") && c.sql.includes("COMMIT"))
    assert.equal(migrationCalls.length, 2)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 QA-009: migrateProduction skips already-applied files on retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-migrate-skip-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 'a'")
  writeFileSync(join(dir, "supabase", "migrations", "20260504130000_b.sql"), "select 'b_BAD'")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    // First run: file 2 fails. File 1 should be tracked, file 2 should NOT.
    const client = fakeClient({ failOnContains: "b_BAD" })
    const adapter = createSupabaseAdapter({ repos, client })
    const first = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "production" })
    assert.equal(first.ok, false)
    assert.ok(client.tracked.has("supabase/migrations/20260504120000_a.sql"))
    assert.ok(!client.tracked.has("supabase/migrations/20260504130000_b.sql"))

    // Fix file 2 by rewriting it (simulate operator fix), but keep the same fake client
    // so its `tracked` set is preserved across the retry.
    writeFileSync(join(dir, "supabase", "migrations", "20260504130000_b.sql"), "select 'b_OK'")
    const adapter2 = createSupabaseAdapter({ repos, client })
    // Reset call log to count second-run activity precisely.
    client.calls.length = 0
    const second = await adapter2.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "production" })
    assert.equal(second.ok, true)
    // Second run must NOT re-run file 1 — only file 2's BEGIN/COMMIT block should appear.
    const migrationBlocks = client.calls.filter(c => c.sql.includes("BEGIN") && c.sql.includes("COMMIT"))
    assert.equal(migrationBlocks.length, 1)
    assert.ok(migrationBlocks[0].sql.includes("b_OK"))
    assert.ok(!migrationBlocks[0].sql.includes("'a'"))
    assert.ok(client.tracked.has("supabase/migrations/20260504130000_b.sql"))
    // The result should report that only file 2 was applied (file 1 skipped).
    const applied = (second.context as { applied?: string[] }).applied ?? []
    assert.equal(applied.length, 1)
    assert.ok(applied[0].endsWith("20260504130000_b.sql"))
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 QA-009: migrateProduction wraps each file's SQL inside its own BEGIN/COMMIT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-migrate-tx-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 'a-body'")
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const client = fakeClient()
    const adapter = createSupabaseAdapter({ repos, client })
    const result = await adapter.migrateProduction({ workspaceRoot: dir, projectRef: "proj", branchRef: "production" })
    assert.equal(result.ok, true)
    const block = client.calls.find(c => c.sql.includes("BEGIN") && c.sql.includes("a-body"))
    assert.ok(block, "expected a transaction block carrying the migration body")
    // Order: BEGIN first, body, INSERT tracking, COMMIT last.
    const sql = block!.sql
    const beginIdx = sql.indexOf("BEGIN")
    const bodyIdx = sql.indexOf("a-body")
    const insertIdx = sql.indexOf("INSERT INTO __beerengineer_migrations")
    const commitIdx = sql.indexOf("COMMIT")
    assert.ok(beginIdx >= 0 && beginIdx < bodyIdx, "BEGIN must come before body")
    assert.ok(bodyIdx < insertIdx, "body must come before tracking INSERT")
    assert.ok(insertIdx < commitIdx, "tracking INSERT must come before COMMIT")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

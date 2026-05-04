import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applySupabaseMigrationsAndSeeds } from "../../../src/core/supabase/migrationRunner.js"

test("PROJ-4 PRD-2 US-3: migration runner applies migrations in timestamp order then seed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-migrations-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120001_second.sql"), "select 2")
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_first.sql"), "select 1")
  writeFileSync(join(dir, "supabase", "seed.sql"), "insert seed")
  const calls: string[] = []
  try {
    const applied = await applySupabaseMigrationsAndSeeds({
      workspaceRoot: dir,
      projectRef: "proj_1",
      branchRef: "br_1",
      client: { runQuery: async (_project, _branch, sql) => { calls.push(sql) } },
    })
    assert.deepEqual(calls, ["select 1", "select 2", "insert seed"])
    assert.deepEqual(applied.map(entry => entry.kind), ["migration", "migration", "seed"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-2 US-3: duplicate migration timestamps abort before applying", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-migrations-dup-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_a.sql"), "select 1")
  writeFileSync(join(dir, "supabase", "migrations", "20260504120000_b.sql"), "select 2")
  try {
    await assert.rejects(() => applySupabaseMigrationsAndSeeds({
      workspaceRoot: dir,
      projectRef: "proj_1",
      branchRef: "br_1",
      client: { runQuery: async () => undefined },
    }), /Duplicate Supabase migration timestamp/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

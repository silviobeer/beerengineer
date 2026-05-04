import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectSupabaseDrift } from "../../../src/core/supabase/driftDetector.js"

test("PROJ-4 PRD-8 US-4: drift detector reports missing, extra, and identity drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-drift-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "001_a.sql"), "select 1")
  try {
    assert.equal(detectSupabaseDrift({ workspaceRoot: dir, appliedMigrations: ["001_a.sql"] }).status, "ready")
    const report = detectSupabaseDrift({ workspaceRoot: dir, appliedMigrations: ["999_extra.sql"], seedIdentityRows: [{ id: "seed", expected: 1, actual: 2 }] })
    assert.deepEqual(report.missingMigrations, ["001_a.sql"])
    assert.deepEqual(report.extraMigrations, ["999_extra.sql"])
    assert.deepEqual(report.identityDrift, ["seed"])
    assert.equal(report.status, "drifted")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

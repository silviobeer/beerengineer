import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectMainBranchOccupancy } from "../../../src/core/supabase/mainBranchOccupancy.js"

test("PROJ-4 PRD-2 US-4: main branch occupancy detects baseline requirement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-occupancy-"))
  try {
    const occupied = await detectMainBranchOccupancy({
      workspaceRoot: dir,
      projectRef: "proj_1",
      client: { runQuery: async () => ({ rows: [{ table_count: 2 }] }) },
    })
    assert.deepEqual(occupied, { occupancy: true, requiresBaseline: true, reason: "remote_schema_without_local_migrations" })
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
    writeFileSync(join(dir, "supabase", "migrations", "20260504120000_base.sql"), "create table demo(id int)")
    assert.deepEqual(await detectMainBranchOccupancy({
      workspaceRoot: dir,
      projectRef: "proj_1",
      client: { runQuery: async () => ({ rows: [{ table_count: 2 }] }) },
    }), { occupancy: true, requiresBaseline: false })
    assert.deepEqual(await detectMainBranchOccupancy({
      workspaceRoot: dir,
      projectRef: "proj_1",
      client: { runQuery: async () => ({ rows: [{ table_count: 0 }] }) },
    }), { occupancy: false, requiresBaseline: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../../src/db/connection.js"

test("PROJ-4 PRD-2 US-5: workspace supabase columns are added idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-columns-"))
  try {
    const path = join(dir, "db.sqlite")
    initDatabase(path).close()
    const db = initDatabase(path)
    const cols = db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>
    assert.ok(cols.some(col => col.name === "supabase_project_ref"))
    assert.ok(cols.some(col => col.name === "supabase_region"))
    assert.ok(cols.some(col => col.name === "supabase_protection_switch"))
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


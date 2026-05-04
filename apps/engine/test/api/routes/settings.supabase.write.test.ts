import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { patchSupabaseSettings } from "../../../src/setup/supabaseSettings.js"

test("PROJ-4 PRD-3 US-2: settings write validates ttl, confirmation, and optimistic concurrency", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-settings-write-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  try {
    assert.equal(patchSupabaseSettings(repos, {
      workspaceId: workspace.id,
      cleanupPolicy: "ttl-after-success",
      cleanupTtlHours: 0,
      productionMigrationProtection: "off",
      expectedVersion: 1,
    }).ok, false)
    assert.equal(patchSupabaseSettings(repos, {
      workspaceId: workspace.id,
      cleanupPolicy: "manual",
      productionMigrationProtection: "on",
      expectedVersion: 1,
    }).ok, false)
    const saved = patchSupabaseSettings(repos, {
      workspaceId: workspace.id,
      cleanupPolicy: "ttl-after-success",
      cleanupTtlHours: 24,
      productionMigrationProtection: "on",
      expectedVersion: 1,
      confirmed: true,
    })
    assert.equal(saved.ok, true)
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_cleanup_ttl_hours, 24)
    assert.equal(patchSupabaseSettings(repos, {
      workspaceId: workspace.id,
      cleanupPolicy: "manual",
      productionMigrationProtection: "off",
      expectedVersion: 1,
    }).ok, false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

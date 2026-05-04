import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { buildMergeStatus, type MergeStatusResult } from "../../../src/api/mergeStatus.js"

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-status-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  return { dir, db, repos }
}

function hasGates(status: MergeStatusResult): status is Exclude<MergeStatusResult, null | { supabaseRelevant: false }> {
  return status !== null && (status as { supabaseRelevant?: false }).supabaseRelevant !== false
}

test("PROJ-4 PRD-9 US-3: merge status exposes four named gates with block reasons", () => {
  const { dir, db, repos } = freshDb()
  try {
    // Workspace WITH Supabase project ref → gates object expected.
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj_supa_1", region: "eu-central-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseLifecycleState(run.id, "validated")
    const status = buildMergeStatus({
      repos,
      runId: run.id,
      destructiveFindings: [{ kind: "drop-table", file: "001.sql", line: 1, redactedSnippet: "drop table users" }],
    })
    assert.ok(hasGates(status), "expected full gate object for Supabase-linked workspace")
    assert.deepEqual(Object.keys(status.gates), ["finalValidation", "protectionSwitch", "destructiveConfirmation", "productionMigration"])
    assert.equal(status.gates.finalValidation.status, "pass")
    assert.equal(status.gates.protectionSwitch.status, "block")
    assert.equal(status.gates.protectionSwitch.reason, "protection switch off")
    assert.equal(status.gates.destructiveConfirmation.status, "block")
    assert.equal(status.gates.productionMigration.status, "skipped")
    assert.equal(status.gates.productionMigration.reason, "production-migration-skipped-because-off")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-011: workspace without Supabase + run without branch → supabaseRelevant: false (no gates)", () => {
  const { dir, db, repos } = freshDb()
  try {
    const ws = repos.upsertWorkspace({ key: "plain", name: "Plain", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    const status = buildMergeStatus({ repos, runId: run.id })
    assert.deepEqual(status, { supabaseRelevant: false })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-011: workspace without Supabase but destructive findings → still emits gate object", () => {
  const { dir, db, repos } = freshDb()
  try {
    const ws = repos.upsertWorkspace({ key: "plain", name: "Plain", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    const status = buildMergeStatus({
      repos,
      runId: run.id,
      destructiveFindings: [{ kind: "drop-table", file: "001.sql", line: 1, redactedSnippet: "drop table users" }],
    })
    assert.ok(hasGates(status), "destructive findings make Supabase-relevant regardless of workspace ref")
    assert.equal(status.gates.destructiveConfirmation.status, "block")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-011: unknown runId → null (404 sentinel)", () => {
  const { dir, db, repos } = freshDb()
  try {
    const status = buildMergeStatus({ repos, runId: "does-not-exist" })
    assert.equal(status, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

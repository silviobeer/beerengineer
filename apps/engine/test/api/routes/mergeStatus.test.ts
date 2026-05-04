import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { buildMergeStatus } from "../../../src/api/mergeStatus.js"

test("PROJ-4 PRD-9 US-3: merge status exposes four named gates with block reasons", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-status-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseLifecycleState(run.id, "validated")
    const status = buildMergeStatus({
      repos,
      runId: run.id,
      destructiveFindings: [{ kind: "drop-table", file: "001.sql", line: 1, redactedSnippet: "drop table users" }],
    })
    assert.deepEqual(Object.keys(status?.gates ?? {}), ["finalValidation", "protectionSwitch", "destructiveConfirmation", "productionMigration"])
    assert.equal(status?.gates.finalValidation.status, "pass")
    assert.equal(status?.gates.protectionSwitch.status, "block")
    assert.equal(status?.gates.protectionSwitch.reason, "protection switch off")
    assert.equal(status?.gates.destructiveConfirmation.status, "block")
    assert.equal(status?.gates.productionMigration.status, "skipped")
    assert.equal(status?.gates.productionMigration.reason, "production-migration-skipped-because-off")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

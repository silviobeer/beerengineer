import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { busToWorkflowIO, prepareRun } from "../src/core/runOrchestrator.js"

function fixture() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-start-failure-")), "test.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Start failure", description: "" })
  return { db, repos, item }
}

for (const owner of ["cli", "api"] as const) {
  test(`${owner} initial lease registration failure leaves visible recoverable run`, () => {
    const { db, repos, item } = fixture()
    try {
      repos.setItemColumn(item.id, "implementation", "running")
      const original = repos.claimRunWorkerLease.bind(repos)
      repos.claimRunWorkerLease = () => {
        throw new Error("lease write failed")
      }

      assert.throws(() => {
        const bus = createBus()
        prepareRun(
          { id: item.id, title: item.title, description: item.description },
          repos,
          { ...busToWorkflowIO(bus), bus },
          { owner, itemId: item.id },
        )
      }, /lease write failed/)

      repos.claimRunWorkerLease = original
      const run = repos.listRuns()[0]
      assert.ok(run)
      assert.equal(run.status, "failed")
      assert.equal(run.recovery_status, "failed")
      assert.equal(run.recovery_scope, "run")
      assert.equal(run.recovery_scope_ref, null)
      assert.match(run.recovery_summary ?? "", /worker start failed/i)
      const projected = repos.getItem(item.id)
      assert.equal(projected?.phase_status, "failed")
      assert.equal(projected?.current_stage, null)
    } finally {
      db.close()
    }
  })
}

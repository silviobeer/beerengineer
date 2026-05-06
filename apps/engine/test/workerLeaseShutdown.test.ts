import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { recoverApiRunsForShutdown } from "../src/core/orphanRecovery.js"

function fixture() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-shutdown-")), "test.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Shutdown recovery", description: "" })
  return { db, repos, ws, item }
}

test("graceful API shutdown marks only current API-owned active runs recoverable", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const apiRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "api", owner: "api" })
    claimWorkerLease(repos, {
      runId: apiRun.id,
      workerInstanceId: "api-current",
      workerOwnerKind: "api",
      now: 1_700_000_000_000,
    })
    const cliRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "cli", owner: "cli" })
    claimWorkerLease(repos, {
      runId: cliRun.id,
      workerInstanceId: "cli-current",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    const result = await recoverApiRunsForShutdown(repos, { apiWorkerInstanceId: "api-current" })

    assert.deepEqual(result.recoveredRunIds, [apiRun.id])
    assert.equal(repos.getRun(apiRun.id)?.status, "failed")
    assert.equal(repos.getRun(apiRun.id)?.recovery_status, "failed")
    assert.match(repos.getRun(apiRun.id)?.recovery_summary ?? "", /graceful shutdown/i)
    assert.equal(repos.getRun(cliRun.id)?.status, "running")
    assert.equal(repos.getRun(cliRun.id)?.recovery_status, null)
  } finally {
    db.close()
  }
})

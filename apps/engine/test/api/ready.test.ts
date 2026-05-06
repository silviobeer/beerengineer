import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildReadyResponse } from "../../src/api/health.js"
import { initDatabase } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-ready-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  return {
    db,
    repos,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test("/ready is unavailable until startup recovery has completed", () => {
  const { db, repos, close } = fixture()
  try {
    const response = buildReadyResponse(db, repos, {
      startupRecoveryComplete: false,
      shutdownInFlight: false,
    })

    assert.equal(response.status, 503)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.startupRecovery, "pending")
    assert.equal(response.body.shutdown, "idle")
    assert.equal(response.body.db, "ok")
    assert.equal(response.body.leaseWrite, "skipped")
  } finally {
    close()
  }
})

test("/ready is unavailable during graceful shutdown", () => {
  const { db, repos, close } = fixture()
  try {
    const response = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: true,
    })

    assert.equal(response.status, 503)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.shutdown, "in_progress")
    assert.equal(response.body.leaseWrite, "skipped")
  } finally {
    close()
  }
})

test("/ready is unavailable when DB probe fails", () => {
  const { db, repos, close } = fixture()
  db.close()
  try {
    const response = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: false,
    })

    assert.equal(response.status, 503)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.db, "failed")
    assert.equal(response.body.leaseWrite, "skipped")
  } finally {
    close()
  }
})

test("/ready is unavailable when lease write sentinel cannot be touched", () => {
  const { db, repos, close } = fixture()
  const original = repos.touchWorkflowReadinessSentinel.bind(repos)
  repos.touchWorkflowReadinessSentinel = () => {
    throw new Error("sentinel write failed")
  }
  try {
    const response = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: false,
    })

    assert.equal(response.status, 503)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.leaseWrite, "failed")
  } finally {
    repos.touchWorkflowReadinessSentinel = original
    close()
  }
})

test("/ready succeeds through a sentinel write without growing workflow history", () => {
  const { db, repos, close } = fixture()
  try {
    const beforeRuns = db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }
    const beforeItems = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }
    const beforeLogs = db.prepare("SELECT COUNT(*) AS n FROM stage_logs").get() as { n: number }

    const first = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: false,
    })
    const second = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: false,
    })

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.body.ok, true)
    assert.equal(first.body.leaseWrite, "ok")
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n, beforeRuns.n)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n, beforeItems.n)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stage_logs").get() as { n: number }).n, beforeLogs.n)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM workflow_readiness_sentinel").get() as { n: number }).n, 1)
  } finally {
    close()
  }
})

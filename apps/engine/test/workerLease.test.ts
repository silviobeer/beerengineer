import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { applySchema, initDatabase, openDatabase, type Db } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import {
  claimWorkerLease,
  inspectWorkerLease,
  refreshWorkerHeartbeat,
  workerStillOwnsLease,
} from "../src/core/workerLease.js"

function tmpDbPath(prefix = "be2-worker-lease-") {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return join(dir, "test.sqlite")
}

function tmpRepos() {
  const db = initDatabase(tmpDbPath())
  return { db, repos: new Repos(db) }
}

function createRun(repos: Repos) {
  const workspace = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Lease target", description: "" })
  return repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Lease target" })
}

function tableColumns(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
}

function tableNames(db: Db): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name)
}

test("run lease schema fields exist on fresh databases without queue or job tables", () => {
  const { db, repos } = tmpRepos()
  try {
    const columns = tableColumns(db, "runs")
    assert.ok(columns.includes("worker_instance_id"))
    assert.ok(columns.includes("worker_owner_kind"))
    assert.ok(columns.includes("worker_started_at"))
    assert.ok(columns.includes("worker_heartbeat_at"))

    const run = createRun(repos)
    const stored = repos.getRun(run.id)
    assert.equal(stored?.worker_instance_id, null)
    assert.equal(stored?.worker_owner_kind, null)
    assert.equal(stored?.worker_started_at, null)
    assert.equal(stored?.worker_heartbeat_at, null)

    assert.deepEqual(
      tableNames(db).filter(name => /workflow.*(queue|job)|worker.*queue|job.*reclaim/i.test(name)),
      [],
    )
  } finally {
    db.close()
  }
})

test("run lease schema fields are added idempotently to migrated databases", () => {
  const db = openDatabase(tmpDbPath("be2-worker-lease-migrated-"))
  try {
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        current_stage TEXT,
        owner TEXT NOT NULL DEFAULT 'api',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    applySchema(db)
    applySchema(db)

    const repos = new Repos(db)
    const columns = tableColumns(db, "runs")
    assert.ok(columns.includes("worker_instance_id"))
    assert.ok(columns.includes("worker_owner_kind"))
    assert.ok(columns.includes("worker_started_at"))
    assert.ok(columns.includes("worker_heartbeat_at"))

    const run = createRun(repos)
    assert.equal(repos.getRun(run.id)?.worker_owner_kind, null)
  } finally {
    db.close()
  }
})

test("claimWorkerLease records CLI ownership with deterministic timestamps", () => {
  const { db, repos } = tmpRepos()
  try {
    const run = createRun(repos)
    const claimed = claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-process-1",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    assert.equal(claimed?.worker_instance_id, "cli-process-1")
    assert.equal(claimed?.worker_owner_kind, "cli")
    assert.equal(claimed?.worker_started_at, 1_700_000_000_000)
    assert.equal(claimed?.worker_heartbeat_at, 1_700_000_000_000)
    assert.deepEqual(inspectWorkerLease(repos, run.id), {
      runId: run.id,
      workerInstanceId: "cli-process-1",
      workerOwnerKind: "cli",
      startedAt: 1_700_000_000_000,
      heartbeatAt: 1_700_000_000_000,
    })
  } finally {
    db.close()
  }
})

test("claimWorkerLease records API ownership and can refresh heartbeat", () => {
  const { db, repos } = tmpRepos()
  try {
    const run = createRun(repos)
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
      now: 1_700_000_000_000,
    })

    const refresh = refreshWorkerHeartbeat(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
      now: 1_700_000_030_000,
    })

    assert.equal(refresh.kind, "refreshed")
    assert.equal(repos.getRun(run.id)?.worker_heartbeat_at, 1_700_000_030_000)
    assert.equal(workerStillOwnsLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
    }), true)
  } finally {
    db.close()
  }
})

test("refreshWorkerHeartbeat reports lost ownership without updating stale owner", () => {
  const { db, repos } = tmpRepos()
  try {
    const run = createRun(repos)
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
      now: 1_700_000_000_000,
    })

    const refresh = refreshWorkerHeartbeat(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-2",
      workerOwnerKind: "api",
      now: 1_700_000_030_000,
    })

    assert.equal(refresh.kind, "lost")
    assert.equal(refresh.current?.workerInstanceId, "api-instance-1")
    assert.equal(repos.getRun(run.id)?.worker_heartbeat_at, 1_700_000_000_000)
    assert.equal(workerStillOwnsLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-2",
      workerOwnerKind: "api",
    }), false)
  } finally {
    db.close()
  }
})

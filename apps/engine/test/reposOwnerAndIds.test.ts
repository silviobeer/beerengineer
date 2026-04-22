import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-repos-"))
  return initDatabase(join(dir, "test.sqlite"))
}

test("nextItemCode mints monotonically increasing ITEM-#### codes per workspace", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "t", name: "T" })
    const a = repos.createItem({ workspaceId: ws.id, title: "a", description: "" })
    const b = repos.createItem({ workspaceId: ws.id, title: "b", description: "" })
    assert.equal(a.code, "ITEM-0001")
    assert.equal(b.code, "ITEM-0002")
    assert.equal(repos.nextItemCode(ws.id), "ITEM-0003")
  } finally {
    db.close()
  }
})

test("nextItemCode sequences are per-workspace", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const w1 = repos.upsertWorkspace({ key: "w1", name: "W1" })
    const w2 = repos.upsertWorkspace({ key: "w2", name: "W2" })
    repos.createItem({ workspaceId: w1.id, title: "w1-a", description: "" })
    const w2a = repos.createItem({ workspaceId: w2.id, title: "w2-a", description: "" })
    assert.equal(w2a.code, "ITEM-0001")
  } finally {
    db.close()
  }
})

test("runs.owner defaults to 'api' and can be set to 'cli'", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "t", name: "T" })
    const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
    const apiRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "api" })
    const cliRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "cli", owner: "cli" })
    assert.equal(apiRun.owner, "api")
    assert.equal(cliRun.owner, "cli")
    assert.equal(repos.getRun(apiRun.id)!.owner, "api")
    assert.equal(repos.getRun(cliRun.id)!.owner, "cli")
  } finally {
    db.close()
  }
})

test("latestActiveRunForItem returns most recent running run", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "t", name: "T" })
    const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
    const r1 = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "r1" })
    repos.updateRun(r1.id, { status: "completed" })
    const r2 = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "r2" })
    const active = repos.latestActiveRunForItem(item.id)
    assert.equal(active?.id, r2.id)
  } finally {
    db.close()
  }
})

test("latestRecoverableRunForItem returns most recent run with recovery state", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "t", name: "T" })
    const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
    const older = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "older" })
    repos.setRunRecovery(older.id, { status: "blocked", scope: "run", scopeRef: null, summary: "older" })
    await new Promise(resolve => setTimeout(resolve, 5))
    const newer = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "newer" })
    repos.setRunRecovery(newer.id, { status: "failed", scope: "run", scopeRef: null, summary: "newer" })

    const recoverable = repos.latestRecoverableRunForItem(item.id)
    assert.equal(recoverable?.id, newer.id)
    assert.equal(recoverable?.recovery_status, "failed")
  } finally {
    db.close()
  }
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { SupabaseDeferredCleanupStore } from "../../../src/core/supabase/deferredCleanupStore.js"
import { runStartupCleanupCatchup } from "../../../src/core/supabase/cleanupCatchup.js"

test("PROJ-4 QA-010: startup catch-up runs once per supabase-connected workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-catchup-boot-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  // Connected workspace with elapsed cleanup
  const ws1 = repos.upsertWorkspace({ key: "ws1", name: "WS1" })
  repos.connectWorkspaceSupabase(ws1.id, { projectRef: "proj-1", region: "eu" })
  // Connected workspace with no due cleanups (still scheduled in the future)
  const ws2 = repos.upsertWorkspace({ key: "ws2", name: "WS2" })
  repos.connectWorkspaceSupabase(ws2.id, { projectRef: "proj-2", region: "eu" })
  // Disconnected workspace (no supabase project ref) — must be skipped.
  repos.upsertWorkspace({ key: "wsX", name: "Disconnected" })

  const store = new SupabaseDeferredCleanupStore(db)
  store.schedule({ workspaceId: ws1.id, branchRef: "br-elapsed", scheduledAt: 100 })
  store.schedule({ workspaceId: ws2.id, branchRef: "br-future", scheduledAt: 10_000 })

  const destroyed: string[] = []
  const adapterCalls: string[] = []
  try {
    const summaries = await runStartupCleanupCatchup({
      repos,
      db,
      now: () => 1_000,
      adapterFor: ({ supabaseProjectRef }) => {
        adapterCalls.push(supabaseProjectRef)
        return {
          destroyBranch: async ctx => {
            destroyed.push(ctx.branchRef ?? "")
            return { ok: true }
          },
        }
      },
      log: () => undefined,
    })
    // Only 2 connected workspaces — disconnected one filtered out by the SQL helper.
    assert.equal(summaries.length, 2)
    assert.deepEqual(adapterCalls.sort(), ["proj-1", "proj-2"])
    // Only ws1's elapsed branch was destroyed.
    assert.deepEqual(destroyed, ["br-elapsed"])
    const ws1Summary = summaries.find(s => s.workspaceKey === "ws1")
    const ws2Summary = summaries.find(s => s.workspaceKey === "ws2")
    assert.equal(ws1Summary?.processed, 1)
    assert.equal(ws2Summary?.processed, 0)
    assert.equal(ws1Summary?.ok, true)
    assert.equal(ws2Summary?.ok, true)
    // The store entry must be removed for the destroyed branch.
    assert.equal(store.get(ws1.id, "br-elapsed"), undefined)
    // And preserved for the not-yet-due branch.
    assert.notEqual(store.get(ws2.id, "br-future"), undefined)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 QA-010: startup catch-up isolates one workspace's failure from the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-catchup-isolation-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const ws1 = repos.upsertWorkspace({ key: "ws1", name: "WS1" })
  repos.connectWorkspaceSupabase(ws1.id, { projectRef: "proj-1", region: "eu" })
  const ws2 = repos.upsertWorkspace({ key: "ws2", name: "WS2" })
  repos.connectWorkspaceSupabase(ws2.id, { projectRef: "proj-2", region: "eu" })
  const store = new SupabaseDeferredCleanupStore(db)
  store.schedule({ workspaceId: ws1.id, branchRef: "br1", scheduledAt: 0 })
  store.schedule({ workspaceId: ws2.id, branchRef: "br2", scheduledAt: 0 })
  try {
    const destroyed: string[] = []
    const summaries = await runStartupCleanupCatchup({
      repos,
      db,
      now: () => 1_000,
      adapterFor: ({ supabaseProjectRef }) => {
        if (supabaseProjectRef === "proj-1") {
          return {
            destroyBranch: async () => { throw new Error("boom") },
          }
        }
        return {
          destroyBranch: async ctx => { destroyed.push(ctx.branchRef ?? ""); return { ok: true } },
        }
      },
      log: () => undefined,
    })
    assert.equal(summaries.length, 2)
    const ws1Summary = summaries.find(s => s.workspaceKey === "ws1")
    const ws2Summary = summaries.find(s => s.workspaceKey === "ws2")
    assert.equal(ws1Summary?.ok, false)
    assert.ok(ws1Summary?.error?.includes("boom"))
    // ws2 must still have processed its branch despite ws1 failing.
    assert.equal(ws2Summary?.ok, true)
    assert.equal(ws2Summary?.processed, 1)
    assert.deepEqual(destroyed, ["br2"])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

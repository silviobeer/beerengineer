import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createOrAttachPersistentTestBranch, persistentTestBranchName } from "../../../src/core/supabase/persistentTestBranch.js"

test("PROJ-4 PRD-2 US-3: attaches to an existing persistent test branch without duplicate create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-attach-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  let createCalls = 0
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [{ id: "br_existing", ref: "br_existing", name: persistentTestBranchName("demo"), status: "ACTIVE_HEALTHY" }],
        createBranch: async () => {
          createCalls += 1
          return { id: "bad", ref: "bad", name: "bad" }
        },
      },
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.action, "attached")
    assert.equal(createCalls, 0)
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_ref, "br_existing")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-2 US-3: create race attaches when provider reports already exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-race-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  let listed = false
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => {
          if (!listed) {
            listed = true
            return []
          }
          return [{ id: "br_race", ref: "br_race", name: persistentTestBranchName("demo"), status: "ACTIVE_HEALTHY" }]
        },
        createBranch: async () => {
          throw Object.assign(new Error("branch already exists"), { status: 409 })
        },
      },
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.action, "attached")
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_ref, "br_race")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

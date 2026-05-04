import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createOrAttachPersistentTestBranch } from "../../../src/core/supabase/persistentTestBranch.js"

test("PROJ-4 PRD-2 US-3: creates and persists the persistent test branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-create-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "Demo App", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  const created: unknown[] = []
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [],
        createBranch: async (_projectRef, input) => {
          created.push(input)
          return { id: "br_1", ref: "br_1", name: input.name, status: "ACTIVE_HEALTHY" }
        },
      },
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.action, "created")
    assert.equal(created.length, 1)
    const stored = repos.getWorkspace(workspace.id)
    assert.equal(stored?.supabase_persistent_test_branch_ref, "br_1")
    assert.equal(stored?.supabase_persistent_test_branch_status, "ACTIVE_HEALTHY")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

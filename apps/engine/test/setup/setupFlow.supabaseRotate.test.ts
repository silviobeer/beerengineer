import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"
import { rotateSupabaseManagementToken } from "../../src/setup/secretActions.supabaseRotate.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../src/setup/secretMetadata.js"
import { readActiveSecretValue, storeSecret } from "../../src/setup/secretStore.js"

test("PROJ-4 PRD-2 US-6: setup-path rotation does not alter workspace metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-rotate-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  repos.setWorkspaceSupabasePersistentBranch(workspace.id, { ref: "br_1", name: "branch", status: "ACTIVE_HEALTHY" })
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "old", { storePath: join(dir, "secrets.json") })
  try {
    const before = repos.getWorkspace(workspace.id)!
    const result = await rotateSupabaseManagementToken({
      token: "new",
      surface: "setup-cli",
      secretStore: { storePath: join(dir, "secrets.json") },
      client: { listProjects: async () => [] },
    })
    const after = repos.getWorkspace(workspace.id)!
    assert.equal(result.ok, true)
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: join(dir, "secrets.json") }), "new")
    assert.equal(after.supabase_project_ref, before.supabase_project_ref)
    assert.equal(after.supabase_region, before.supabase_region)
    assert.equal(after.supabase_persistent_test_branch_ref, before.supabase_persistent_test_branch_ref)
    assert.equal(after.supabase_protection_switch, before.supabase_protection_switch)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

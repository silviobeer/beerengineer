import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { getAppConfigView } from "../../../src/setup/appConfigView.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

test("PROJ-4 PRD-3 US-1: settings read exposes cached supabase block without token material", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-settings-read-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir, lastOpenedAt: 1 })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu", dbMode: "branching" })
  repos.setWorkspaceSupabasePersistentBranch(workspace.id, { ref: "br_1", name: "branch", status: "ACTIVE_HEALTHY", checkedAt: 123 })
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_secret", { storePath: join(dir, "secrets.json") })
  try {
    const view = getAppConfigView({ configPath: join(dir, "missing-config.json"), dataDir: dir }, { repos })
    assert.equal(view.supabase.projectRef, "proj_1")
    assert.equal(view.supabase.dbMode, "branching")
    assert.equal(view.supabase.persistentTestBranchRef, "br_1")
    assert.equal(view.supabase.tokenPresent, true)
    assert.doesNotMatch(JSON.stringify(view), /sbp_secret/)
  } finally {
    delete process.env.BEERENGINEER_SECRET_STORE_PATH
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

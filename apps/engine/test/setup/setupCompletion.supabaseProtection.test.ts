import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"

test("PROJ-4 PRD-2 US-5: supabase protection switch defaults off", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-protection-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    assert.equal(workspace.supabase_protection_switch, "off")
    assert.equal(repos.preserveWorkspaceSupabaseProtection(workspace.id), "off")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


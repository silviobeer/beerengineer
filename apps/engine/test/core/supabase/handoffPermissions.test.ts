import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { writeSupabaseHandoff } from "../../../src/core/supabase/handoffWriter.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"

test("PROJ-4 PRD-6 US-2: handoff directory and file permissions are restrictive", async (t) => {
  if (process.platform === "win32") t.skip("POSIX permissions only")
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-perms-"))
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp", { storePath })
  try {
    const result = await writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run",
      waveId: "wave",
      projectRef: "proj",
      branchRef: "br",
      secretStore: { storePath },
      client: { getProjectKeys: async () => ({ url: "u", anonKey: "a", serviceRoleKey: "s" }), getBranchConnectionString: async () => "db" },
    })
    assert.equal(statSync(dirname(result.path)).mode & 0o777, 0o700)
    assert.equal(statSync(result.path).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeSupabaseHandoff, supabaseHandoffPath } from "../../../src/core/supabase/handoffWriter.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"

test("PROJ-4 PRD-6 US-1: handoff writer writes required dotenv from live API values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-"))
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp", { storePath })
  try {
    const result = await writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run-1",
      waveId: "wave-1",
      projectRef: "proj",
      branchRef: "br",
      secretStore: { storePath },
      client: {
        getProjectKeys: async () => ({ url: "https://example.supabase.co", anonKey: "anon", serviceRoleKey: "service" }),
        getBranchConnectionString: async () => "postgres://branch",
      },
    })
    assert.equal(result.path, supabaseHandoffPath(dir, "run-1", "wave-1"))
    assert.deepEqual(result.env, { SUPABASE_HANDOFF_ENV: result.path })
    assert.match(readFileSync(result.path, "utf8"), /SUPABASE_DB_URL=postgres:\/\/branch/)
    await assert.rejects(() => writeSupabaseHandoff({
      workspaceRoot: dir,
      runId: "run-1",
      waveId: "wave-1",
      projectRef: "proj",
      branchRef: "br",
      secretStore: { storePath },
      client: { getProjectKeys: async () => ({ url: "", anonKey: "", serviceRoleKey: "" }), getBranchConnectionString: async () => "" },
    }), /already exists/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

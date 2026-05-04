import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSupabaseCapability, SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/core/capabilities/supabaseCapability.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

test("PROJ-4 PRD-8 US-4: supabase repair is non-destructive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cap-repair-"))
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "001_a.sql"), "select 1")
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp", { storePath })
  try {
    const cap = createSupabaseCapability({
      workspace: { rootPath: dir, projectRef: "proj", persistentTestBranchRef: "br" },
      secretStore: { storePath },
      managementClient: {
        getProject: async () => ({ id: "p", ref: "proj" }),
        listBranches: async () => [],
        runQuery: async (_p, _b, sql) => sql.includes("schema_migrations") ? { rows: [{ name: "999_extra.sql" }] } : { rows: [] },
      },
    })
    const result = await cap.ports.repair!()
    assert.equal(result.reason, "non-destructive-repair-insufficient")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

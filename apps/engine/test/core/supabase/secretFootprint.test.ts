import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { supabaseCapability } from "../../../src/core/capabilities/supabaseCapability.js"

test("PROJ-4 PRD-1 US-4: writing supabase token creates no per-secret file under .beerengineer/secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-secret-footprint-"))
  try {
    const workspaceSecretsDir = join(dir, ".beerengineer", "secrets")
    mkdirSync(workspaceSecretsDir, { recursive: true })
    const before = readdirSync(workspaceSecretsDir).sort()

    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", {
      storePath: join(dir, "state", "secrets.json"),
    })

    assert.deepEqual(readdirSync(workspaceSecretsDir).sort(), before)
    assert.equal("writeBranchCredentials" in supabaseCapability, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


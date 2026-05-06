import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  KNOWN_SECRET_REFS,
  SUPABASE_MANAGEMENT_TOKEN_SECRET_REF,
  readSecretMetadata,
} from "../../src/setup/secretMetadata.js"
import { applySecretAction } from "../../src/setup/secretActions.js"
import { deleteSecret, storeSecret } from "../../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-secret-metadata-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("PROJ-4 PRD-1 US-4: supabase management token ref is documented in secret metadata", () => {
  assert.equal(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "supabase.management_token")
  assert.ok(KNOWN_SECRET_REFS.includes(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF))
})

test("PROJ-4 PRD-1 US-4: supabase token round-trips through the existing secret store API", () => {
  const paths = tempSecretStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    assert.equal(readSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: paths.storePath }).status, "active")

    deleteSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: paths.storePath })
    assert.equal(readSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: paths.storePath }).status, "missing")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-3: generic secret mutations deny the Supabase management token", () => {
  const paths = tempSecretStore()
  try {
    const result = applySecretAction(
      SUPABASE_MANAGEMENT_TOKEN_SECRET_REF,
      { action: "replace", value: "sbp-secret" },
      { storePath: paths.storePath },
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, "supabase_management_token_requires_dedicated_flow")
    assert.equal(readSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: paths.storePath }).status, "missing")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

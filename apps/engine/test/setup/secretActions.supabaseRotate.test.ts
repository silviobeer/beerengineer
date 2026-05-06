import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rotateSupabaseManagementToken } from "../../src/setup/secretActions.supabaseRotate.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../src/setup/secretMetadata.js"
import { readActiveSecretValue, storeSecret } from "../../src/setup/secretStore.js"
import { SupabaseManagementError } from "../../src/core/supabase/managementClient.js"

test("PROJ-4 PRD-3 US-5: rotation validates before persist and emits tokenless audit event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-rotate-"))
  const storePath = join(dir, "secrets.json")
  const events: unknown[] = []
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "old", { storePath })
    const failed = await rotateSupabaseManagementToken({
      token: "bad",
      surface: "ui",
      secretStore: { storePath },
      client: { listProjects: async () => { throw new Error("Invalid token sbp_[redacted]") } },
      auditSink: event => events.push(event),
    })
    assert.equal(failed.ok, false)
    if (!failed.ok) assert.equal(failed.recoveryAction, "Rotate management token")
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath }), "old")
    assert.equal(events.length, 0)
    const ok = await rotateSupabaseManagementToken({
      token: "new",
      surface: "setup-ui",
      secretStore: { storePath },
      now: () => 123,
      client: { listProjects: async () => [] },
      auditSink: event => events.push(event),
    })
    assert.equal(ok.ok, true)
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath }), "new")
    assert.deepEqual(events, [{ type: "supabase.token.rotated", timestamp: 123, surface: "setup-ui" }])
    assert.doesNotMatch(JSON.stringify(events), /new|old/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-3: rotation maps 403 project access failures to re-authorize action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-rotate-403-"))
  const storePath = join(dir, "secrets.json")
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "old", { storePath })
    const failed = await rotateSupabaseManagementToken({
      token: "new",
      surface: "setup-cli",
      secretStore: { storePath },
      client: { listProjects: async () => { throw new SupabaseManagementError("provider", "Project access denied", 403) } },
    })

    assert.equal(failed.ok, false)
    if (!failed.ok) assert.equal(failed.recoveryAction, "Re-authorize project access")
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath }), "old")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

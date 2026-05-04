import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rotateSupabaseManagementToken } from "../../src/setup/secretActions.supabaseRotate.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../src/setup/secretMetadata.js"
import { readActiveSecretValue, storeSecret } from "../../src/setup/secretStore.js"

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

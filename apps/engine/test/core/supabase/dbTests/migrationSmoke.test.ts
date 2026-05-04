import { test } from "node:test"
import assert from "node:assert/strict"
import { migrationSmoke } from "../../../../src/core/supabase/dbTests/migrationSmoke.js"

test("PROJ-4 PRD-5 US-4: migration smoke detects duplicate migration names", () => {
  assert.deepEqual(migrationSmoke([{ path: "a.sql", kind: "migration" }]), { ok: true })
  assert.deepEqual(migrationSmoke([{ path: "a.sql", kind: "migration" }, { path: "nested/a.sql", kind: "migration" }]), {
    ok: false,
    reason: "duplicate migration names",
  })
})

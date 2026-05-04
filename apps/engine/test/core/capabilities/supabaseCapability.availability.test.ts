import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSupabaseCapability, SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/core/capabilities/supabaseCapability.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-availability-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("PROJ-4 PRD-1 US-3: availability is false when token and project ref are absent", async () => {
  const paths = tempStore()
  try {
    const capability = createSupabaseCapability({ secretStore: { storePath: paths.storePath } })

    assert.deepEqual(await capability.ports.availability!(), {
      capabilityId: "supabase",
      available: false,
      reason: "management token missing and project ref missing",
    })
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-1 US-3: availability is true from local token metadata plus workspace project ref", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const capability = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_123" },
    })

    assert.deepEqual(await capability.ports.availability!(), {
      capabilityId: "supabase",
      available: true,
      reason: "configured",
      context: { projectRef: "proj_123" },
    })
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-1 US-3: availability performs no provider fetch", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error("fetch must not be called by availability")
  }) as typeof fetch
  try {
    const paths = tempStore()
    try {
      const capability = createSupabaseCapability({ secretStore: { storePath: paths.storePath } })
      const result = await capability.ports.availability!()
      assert.equal(result.available, false)
    } finally {
      rmSync(paths.dir, { recursive: true, force: true })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})


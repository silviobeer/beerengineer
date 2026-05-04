import { test } from "node:test"
import assert from "node:assert/strict"

test("PROJ-4 PRD-1 US-5: importing the engine capability graph performs no Supabase provider call", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error("fetch must not be called at boot")
  }) as typeof fetch
  try {
    const capabilities = await import("../../../src/core/capabilities/index.js")
    assert.equal(capabilities.getCapability("supabase").id, "supabase")
  } finally {
    globalThis.fetch = originalFetch
  }
})


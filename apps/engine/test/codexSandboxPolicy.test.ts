import { test } from "node:test"
import assert from "node:assert/strict"

import {
  markCodexSandboxCapabilitySupported,
  resetCodexSandboxPolicyForTests,
  resolveCodexSandboxBypass,
  setCodexSandboxCapabilityProbeForTests,
} from "../src/llm/hosted/providers/codexSandboxPolicy.js"

test("explicit sandbox bypass override wins ahead of cached capability", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()

  const resolution = await resolveCodexSandboxBypass(
    "safe-workspace-write",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "1" },
  )

  assert.deepEqual(resolution, { bypass: true, source: "explicit" })
})

test("sandbox capability probing times out quickly and updates the cache later", async () => {
  resetCodexSandboxPolicyForTests()
  setCodexSandboxCapabilityProbeForTests(
    () =>
      new Promise(resolve => {
        setTimeout(() => resolve("unsupported"), 60)
      }),
  )

  const startedAt = Date.now()
  const first = await resolveCodexSandboxBypass("safe-workspace-write", {}, 10)
  const elapsedMs = Date.now() - startedAt
  assert.deepEqual(first, { bypass: false, source: "default" })
  assert.ok(elapsedMs < 50, `expected the probe timeout to return quickly, got ${elapsedMs} ms`)

  await new Promise(resolve => setTimeout(resolve, 80))
  const second = await resolveCodexSandboxBypass("safe-workspace-write", {}, 10)
  assert.deepEqual(second, { bypass: true, source: "capability" })
})

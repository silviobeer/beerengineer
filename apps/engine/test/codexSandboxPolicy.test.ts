import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  markCodexSandboxCapabilityUnsupported,
  markCodexSandboxCapabilitySupported,
  resetCodexSandboxPolicyForTests,
  resolveCodexSandboxBypass,
  setCodexSandboxCapabilityStore,
  setCodexSandboxCapabilityProbeForTests,
} from "../src/llm/hosted/providers/codexSandboxPolicy.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

test("explicit sandbox bypass override wins ahead of cached capability without destroying it", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()

  const resolution = await resolveCodexSandboxBypass(
    "safe-workspace-write",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "1" },
  )

  assert.deepEqual(resolution, { bypass: true, source: "explicit" })

  const restored = await resolveCodexSandboxBypass("safe-workspace-write", {})
  assert.deepEqual(restored, { bypass: false, source: "capability" })
})

test("unsupported capability resolves tool-using policies to bypass", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilityUnsupported()

  const resolution = await resolveCodexSandboxBypass("safe-workspace-write", {})
  assert.deepEqual(resolution, { bypass: true, source: "capability" })
})

test("sandbox capability probing times out quickly, bypasses safely, and updates the cache later", async () => {
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
  assert.deepEqual(first, { bypass: true, source: "default" })
  assert.ok(elapsedMs < 50, `expected the probe timeout to return quickly, got ${elapsedMs} ms`)

  await new Promise(resolve => setTimeout(resolve, 80))
  const second = await resolveCodexSandboxBypass("safe-workspace-write", {}, 10)
  assert.deepEqual(second, { bypass: true, source: "capability" })
})

test("policies that already decide sandboxing stay on their existing path", async () => {
  resetCodexSandboxPolicyForTests()
  setCodexSandboxCapabilityProbeForTests(async () => "unsupported")

  assert.deepEqual(await resolveCodexSandboxBypass("no-tools", {}), {
    bypass: false,
    source: "policy",
  })
  assert.deepEqual(await resolveCodexSandboxBypass("unsafe-autonomous-write", {}), {
    bypass: true,
    source: "policy",
  })
})

test("persisted capability snapshots are reused before probing again", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-sandbox-policy-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  let probes = 0

  try {
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? "unknown",
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    markCodexSandboxCapabilitySupported()

    resetCodexSandboxPolicyForTests()
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? "unknown",
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    setCodexSandboxCapabilityProbeForTests(async () => {
      probes += 1
      return "unsupported"
    })

    const resolution = await resolveCodexSandboxBypass("safe-workspace-write", {})
    assert.deepEqual(resolution, { bypass: false, source: "capability" })
    assert.equal(probes, 0)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("malformed persisted capability bypasses immediately while revalidating in the background", async () => {
  resetCodexSandboxPolicyForTests()
  let probes = 0
  let persisted: string | null = "future-format"

  setCodexSandboxCapabilityStore({
    load: () => persisted as "supported" | "unsupported" | "unknown" | null,
    persist: capability => {
      persisted = capability
    },
  })
  setCodexSandboxCapabilityProbeForTests(async () => {
    probes += 1
    return "supported"
  })

  const first = await resolveCodexSandboxBypass("safe-workspace-write", {})
  assert.deepEqual(first, { bypass: true, source: "default" })
  assert.equal(probes, 1)

  await new Promise(resolve => setTimeout(resolve, 0))
  const second = await resolveCodexSandboxBypass("safe-workspace-write", {})
  assert.deepEqual(second, { bypass: false, source: "capability" })
  assert.equal(persisted, "supported")
})

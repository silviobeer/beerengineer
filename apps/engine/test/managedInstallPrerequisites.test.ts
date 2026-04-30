import { test } from "node:test"
import assert from "node:assert/strict"

import { runManagedInstallPrerequisiteProbe } from "../src/core/managedInstall/prerequisites.js"

test("runManagedInstallPrerequisiteProbe reports ok when node npm and git satisfy requirements", async () => {
  const phase = await runManagedInstallPrerequisiteProbe({
    nodeVersion: "v22.3.0",
    probeCommand: async command => ({ ok: true, detail: `${command} ok` }),
  })

  assert.equal(phase.name, "prerequisites")
  assert.equal(phase.status, "ok")
  assert.equal(phase.fixHint, undefined)
  assert.equal(typeof phase.durationMs, "number")
})

test("runManagedInstallPrerequisiteProbe fails with actionable hints for missing tools", async () => {
  const phase = await runManagedInstallPrerequisiteProbe({
    nodeVersion: "v22.3.0",
    probeCommand: async command => command === "npm"
      ? { ok: false, detail: "not found" }
      : { ok: true, detail: `${command} ok` },
  })

  assert.equal(phase.status, "failed")
  assert.match(phase.message, /npm/)
  assert.match(phase.fixHint ?? "", /Install npm/)
})

test("runManagedInstallPrerequisiteProbe enforces the documented Node version floor", async () => {
  const phase = await runManagedInstallPrerequisiteProbe({
    nodeVersion: "v20.11.0",
    probeCommand: async command => ({ ok: true, detail: `${command} ok` }),
  })

  assert.equal(phase.status, "failed")
  assert.match(phase.message, /Node.js >= 22/)
  assert.match(phase.fixHint ?? "", /Install Node.js 22/)
})

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { generateSetupReport, runSetupRecheck } from "../src/setup/doctor.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-recheck-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

test("PRD-1 AC-17 re-checks return fresh status values", async () => {
  const paths = tempSetupPaths()
  try {
    const first = await runSetupRecheck({ overrides: { configPath: paths.configPath, dataDir: paths.dataDir } })
    const second = await runSetupRecheck({ overrides: { configPath: paths.configPath, dataDir: paths.dataDir } })

    assert.equal(second.report.generatedAt >= first.report.generatedAt, true)
    assert.notEqual(second.report, first.report)
    assert.deepEqual(second.report.groups.map(group => group.id), first.report.groups.map(group => group.id))
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PRD-1 AC-18 re-checks can run for all checks or a specific setup group", async () => {
  const paths = tempSetupPaths()
  try {
    const all = await runSetupRecheck({ overrides: { configPath: paths.configPath, dataDir: paths.dataDir } })
    const core = await runSetupRecheck({ group: "core", overrides: { configPath: paths.configPath, dataDir: paths.dataDir } })

    assert.equal(all.report.groups.length > 1, true)
    assert.deepEqual(core.report.groups.map(group => group.id), ["core"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PRD-1 AC-19 transient check failures are reported as understandable error states", async () => {
  const paths = tempSetupPaths()
  try {
    const result = await runSetupRecheck({
      group: "not-a-group",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, "unknown_group")
    assert.equal(result.group, "not-a-group")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PRD-1 AC-20 required gate status clearly supports Next enablement decisions", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      group: "core",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })
    const result = await runSetupRecheck({
      group: "core",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })

    assert.equal(result.ok, true)
    assert.equal(result.requiredGate.blocked, report.overall === "blocked")
    assert.equal(result.requiredGate.canProceed, !result.requiredGate.blocked)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

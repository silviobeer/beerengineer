import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { generateSetupReport } from "../src/setup/doctor.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-status-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

test("AC-1 setup status distinguishes required, recommended, and optional checks", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })

    const levels = new Set(report.groups.map(group => group.level))
    assert.equal(levels.has("required"), true)
    assert.equal(levels.has("recommended"), true)
    assert.equal(levels.has("optional"), true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-2 required failures mark setup as blocked", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      group: "core",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })

    assert.equal(report.overall, "blocked")
    assert.equal(report.groups.every(group => group.level === "required"), true)
    assert.equal(report.groups.some(group => !group.satisfied), true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-3 missing tool/auth checks expose stable metadata and remedy hints", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      group: "llm.opencode",
      overrides: {
        configPath: paths.configPath,
        dataDir: paths.dataDir,
        llmProvider: "opencode",
      },
    })
    const check = report.groups.flatMap(group => group.checks).find(candidate => candidate.id === "llm.opencode.cli")

    assert.ok(check)
    assert.equal(typeof check.id, "string")
    assert.equal(check.id.length > 0, true)
    assert.equal(typeof check.label, "string")
    assert.equal(check.label.length > 0, true)
    assert.match(check.status, /^(ok|missing|misconfigured|skipped|unknown|uninitialized)$/)
    if (check.status !== "ok") {
      assert.equal(typeof check.detail, "string")
      assert.ok(check.remedy?.hint)
    }
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-4 GET /setup/status report keeps the readiness model contract", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })

    assert.equal(report.reportVersion, 1)
    assert.equal(typeof report.generatedAt, "number")
    assert.ok(["ok", "warning", "blocked"].includes(report.overall))
    assert.ok(Array.isArray(report.groups))
    assert.ok(report.groups.every(group => typeof group.id === "string" && Array.isArray(group.checks)))
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-5 all LLM groups does not make inactive providers required blockers", async () => {
  const paths = tempSetupPaths()
  try {
    const report = await generateSetupReport({
      allLlmGroups: true,
      overrides: {
        configPath: paths.configPath,
        dataDir: paths.dataDir,
        llmProvider: "anthropic",
      },
    })

    const inactiveLlmGroups = report.groups.filter(group => group.id.startsWith("llm.") && group.id !== "llm.anthropic")
    assert.equal(inactiveLlmGroups.length, 2)
    assert.equal(inactiveLlmGroups.every(group => group.level === "optional"), true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

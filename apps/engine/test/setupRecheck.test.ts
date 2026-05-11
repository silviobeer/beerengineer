import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import {
  resetCodexSandboxPolicyForTests,
  resolveCodexSandboxBypass,
  setCodexSandboxCapabilityProbeForTests,
  setCodexSandboxCapabilityStore,
} from "../src/llm/hosted/providers/codexSandboxPolicy.js"
import { defaultAppConfig, resolveConfiguredDbPath, writeConfigFile } from "../src/setup/config.js"
import { generateSetupReport, runSetupRecheck } from "../src/setup/doctor.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-recheck-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

function makeStubBin(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
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

test("setup recheck forces a fresh Codex sandbox capability evaluation and later decisions reuse it", async () => {
  resetCodexSandboxPolicyForTests()
  const paths = tempSetupPaths()
  const previousPath = process.env.PATH
  const previousApiKey = process.env.OPENAI_API_KEY
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
  const binDir = join(paths.dir, "bin")
  const config = {
    ...defaultAppConfig(),
    dataDir: paths.dataDir,
    llm: {
      ...defaultAppConfig().llm,
      provider: "openai" as const,
      model: "gpt-5.4",
      apiKeyRef: "OPENAI_API_KEY",
    },
  }
  writeConfigFile(paths.configPath, config)

  const db = initDatabase(resolveConfiguredDbPath(config))
  const repos = new Repos(db)
  let probes = 0

  try {
    repos.setCodexSandboxCapabilitySnapshot("supported")
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    setCodexSandboxCapabilityProbeForTests(async () => {
      probes += 1
      return "unsupported"
    })
    makeStubBin(binDir, "codex", "echo 'codex 0.0.0-test'")
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
    process.env.OPENAI_API_KEY = "test-key"
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

    const before = await generateSetupReport({
      group: "llm.openai",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, llmProvider: "openai" },
    })
    const beforeCheck = before.groups.flatMap(group => group.checks).find(check => check.id === "llm.openai.sandbox")
    assert.equal(beforeCheck?.status, "ok")
    assert.match(beforeCheck?.detail ?? "", /supported/i)

    const rechecked = await runSetupRecheck({
      group: "llm.openai",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, llmProvider: "openai" },
    })
    const recheckedCheck = rechecked.report.groups.flatMap(group => group.checks).find(check => check.id === "llm.openai.sandbox")
    assert.equal(recheckedCheck?.status, "missing")
    assert.match(recheckedCheck?.detail ?? "", /unsupported/i)

    const resolution = await resolveCodexSandboxBypass("safe-workspace-write", {})
    assert.deepEqual(resolution, { bypass: true, source: "capability" })

    const after = await generateSetupReport({
      group: "llm.openai",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, llmProvider: "openai" },
    })
    const afterCheck = after.groups.flatMap(group => group.checks).find(check => check.id === "llm.openai.sandbox")
    assert.equal(afterCheck?.status, "missing")
    assert.match(afterCheck?.detail ?? "", /unsupported/i)
    assert.equal(probes, 1)
  } finally {
    db.close()
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousApiKey
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(paths.dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

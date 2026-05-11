import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import {
  resetCodexSandboxPolicyForTests,
  resolveCodexSandboxBypass,
} from "../src/llm/hosted/providers/codexSandboxPolicy.js"
import { defaultAppConfig, resolveConfiguredDbPath, writeConfigFile } from "../src/setup/config.js"
import { generateSetupReport } from "../src/setup/doctor.js"
import { storeSecret } from "../src/setup/secretStore.js"

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

test("review setup checks accept SONAR_TOKEN from the local secret store", async () => {
  const paths = tempSetupPaths()
  const originalSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  const originalSonarToken = process.env.SONAR_TOKEN
  try {
    delete process.env.SONAR_TOKEN
    process.env.BEERENGINEER_SECRET_STORE_PATH = join(paths.dir, "secrets.json")
    storeSecret("SONAR_TOKEN", "stored-token")

    const report = await generateSetupReport({
      group: "review",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })
    const tokenCheck = report.groups.flatMap(group => group.checks).find(check => check.id === "review.sonar-token")

    assert.equal(tokenCheck?.status, "ok")
    assert.equal(tokenCheck?.detail, "Token available for scanner/API auth")
  } finally {
    if (originalSecretStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = originalSecretStorePath
    if (originalSonarToken === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = originalSonarToken
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("review setup checks do not treat env-only SONAR_TOKEN as configured", async () => {
  const paths = tempSetupPaths()
  const originalSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  const originalSonarToken = process.env.SONAR_TOKEN
  try {
    process.env.SONAR_TOKEN = "env-only-token"
    process.env.BEERENGINEER_SECRET_STORE_PATH = join(paths.dir, "secrets.json")

    const report = await generateSetupReport({
      group: "review",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir },
    })
    const tokenCheck = report.groups.flatMap(group => group.checks).find(check => check.id === "review.sonar-token")

    assert.equal(tokenCheck?.status, "missing")
  } finally {
    if (originalSecretStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = originalSecretStorePath
    if (originalSonarToken === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = originalSonarToken
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("OpenAI setup status hydrates the Codex sandbox cache from persisted capability", async () => {
  resetCodexSandboxPolicyForTests()
  const paths = tempSetupPaths()
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
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

  try {
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    repos.setCodexSandboxCapabilitySnapshot("unsupported")

    const report = await generateSetupReport({
      group: "llm.openai",
      overrides: { configPath: paths.configPath, dataDir: paths.dataDir, llmProvider: "openai" },
    })
    const sandboxCheck = report.groups.flatMap(group => group.checks).find(check => check.id === "llm.openai.sandbox")

    assert.equal(sandboxCheck?.status, "missing")
    assert.match(sandboxCheck?.detail ?? "", /unsupported/i)
    assert.deepEqual(await resolveCodexSandboxBypass("safe-workspace-write", {}), {
      bypass: true,
      source: "capability",
    })
  } finally {
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

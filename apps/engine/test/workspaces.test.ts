import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { previewWorkspace, registerWorkspace, validateHarnessProfile } from "../src/core/workspaces.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { defaultAppConfig } from "../src/setup/config.js"
import type { SetupReport } from "../src/setup/types.js"

function readyReport(): SetupReport {
  return {
    reportVersion: 1,
    overall: "ok",
    generatedAt: Date.now(),
    groups: [
      {
        id: "llm.anthropic",
        label: "Anthropic capability",
        level: "required",
        minOk: 2,
        passed: 2,
        satisfied: true,
        ideal: true,
        checks: [
          { id: "llm.anthropic.cli", label: "Claude CLI", status: "ok" },
          { id: "llm.anthropic.auth", label: "Claude auth", status: "ok" },
        ],
      },
      {
        id: "llm.openai",
        label: "OpenAI capability",
        level: "required",
        minOk: 2,
        passed: 2,
        satisfied: true,
        ideal: true,
        checks: [
          { id: "llm.openai.cli", label: "Codex CLI", status: "ok" },
          { id: "llm.openai.auth", label: "Codex auth", status: "ok" },
        ],
      },
      {
        id: "llm.opencode",
        label: "OpenCode capability",
        level: "required",
        minOk: 2,
        passed: 0,
        satisfied: false,
        ideal: false,
        checks: [
          { id: "llm.opencode.cli", label: "OpenCode CLI", status: "missing" },
          { id: "llm.opencode.auth", label: "OpenCode auth", status: "missing" },
        ],
      },
    ],
  }
}

test("validateHarnessProfile rejects missing harnesses and accepts fast mode", () => {
  const report = readyReport()
  assert.equal(validateHarnessProfile({ mode: "fast" }, report).ok, true)
  const missing = validateHarnessProfile(
    {
      mode: "self",
      roles: {
        coder: { harness: "opencode", provider: "openrouter", model: "x" },
        reviewer: { harness: "claude", provider: "anthropic", model: "claude-haiku-4-5" },
      },
    },
    report,
  )
  assert.equal(missing.ok, false)
  assert.match(missing.error?.detail ?? "", /opencode/)
})

test("previewWorkspace detects greenfield vs brownfield and registration state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const path = join(dir, "demo")

    const greenfield = await previewWorkspace(path, config, repos)
    assert.equal(greenfield.exists, false)
    assert.equal(greenfield.isGreenfield, true)

    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true, organization: "acme" },
        git: { init: false },
      },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)

    const brownfield = await previewWorkspace(path, config, repos)
    assert.equal(brownfield.exists, true)
    assert.equal(brownfield.isRegistered, true)
    assert.equal(brownfield.hasWorkspaceConfigFile, true)
    assert.equal(brownfield.hasSonarProperties, true)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("registerWorkspace writes workspace config and sonar properties", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = {
      ...defaultAppConfig(),
      allowedRoots: [dir],
      llm: {
        ...defaultAppConfig().llm,
        defaultSonarOrganization: "acme",
      },
    }
    const path = join(dir, "demo")
    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true },
        git: { init: false },
      },
      { repos, config, appReport: readyReport() },
    )

    assert.equal(result.ok, true)
    if (!result.ok) return

    const workspaceJson = JSON.parse(readFileSync(join(path, ".beerengineer", "workspace.json"), "utf8")) as {
      schemaVersion: number
      key: string
      harnessProfile: { mode: string }
      runtimePolicy: { stageAuthoring: string; reviewer: string; coderExecution: string }
      sonar: { organization?: string; projectKey?: string }
    }
    assert.equal(workspaceJson.schemaVersion, 2)
    assert.equal(workspaceJson.key, "demo")
    assert.equal(workspaceJson.harnessProfile.mode, "fast")
    assert.equal(workspaceJson.runtimePolicy.stageAuthoring, "safe-readonly")
    assert.equal(workspaceJson.runtimePolicy.reviewer, "safe-readonly")
    assert.equal(workspaceJson.runtimePolicy.coderExecution, "safe-workspace-write")
    assert.equal(workspaceJson.sonar.organization, "acme")
    assert.equal(workspaceJson.sonar.projectKey, "demo")

    const sonarProperties = readFileSync(join(path, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=demo/)
    assert.match(sonarProperties, /sonar.organization=acme/)

    const dbWorkspace = repos.getWorkspaceByKey("demo")
    assert.equal(dbWorkspace?.sonar_enabled, 1)
    assert.equal(JSON.parse(dbWorkspace?.harness_profile_json ?? "{}").mode, "fast")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("readWorkspaceConfig upgrades schemaVersion 1 files with default runtime policy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  try {
    const root = join(dir, "legacy")
    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 1,
        key: "legacy",
        name: "Legacy",
        harnessProfile: { mode: "claude-first" },
        sonar: { enabled: false },
        createdAt: 123,
      }, null, 2),
    )

    const config = await import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(root))
    assert.equal(config?.schemaVersion, 2)
    assert.deepEqual(config?.runtimePolicy, {
      stageAuthoring: "safe-readonly",
      reviewer: "safe-readonly",
      coderExecution: "safe-workspace-write",
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

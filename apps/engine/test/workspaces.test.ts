import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initGit, previewWorkspace, registerWorkspace, validateHarnessProfile } from "../src/core/workspaces.js"
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
    assert.equal(brownfield.hasSonarProperties, false)
    assert.equal(brownfield.isGitRepo, true)
    if (!result.ok) return
    assert.equal(result.preflight.git.status, "ok")
    assert.equal(result.preflight.github.status, "missing")
    assert.match(readFileSync(join(path, ".gitignore"), "utf8"), /\.env\.local/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("registerWorkspace persists preflight and writes quality config once GitHub remote metadata exists", async () => {
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
    mkdirSync(path, { recursive: true })
    const gitInit = await initGit(path, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)
    const remoteAdd = spawnSync("git", ["remote", "add", "origin", "git@github.com:acme/demo.git"], { cwd: path, encoding: "utf8" })
    assert.equal(remoteAdd.status, 0)
    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true },
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
      preflight: { github: { owner?: string; repo?: string; status: string }; git: { status: string } }
      reviewPolicy: {
        coderabbit: { enabled: boolean }
        sonarcloud: { organization?: string; projectKey?: string; enabled: boolean; region?: string; planTier?: string }
      }
    }
    assert.equal(workspaceJson.schemaVersion, 2)
    assert.equal(workspaceJson.key, "demo")
    assert.equal(workspaceJson.harnessProfile.mode, "fast")
    assert.equal(workspaceJson.runtimePolicy.stageAuthoring, "safe-readonly")
    assert.equal(workspaceJson.runtimePolicy.reviewer, "safe-readonly")
    assert.equal(workspaceJson.runtimePolicy.coderExecution, "safe-workspace-write")
    assert.equal(workspaceJson.sonar.organization, "acme")
    assert.equal(workspaceJson.sonar.projectKey, "acme_demo")
    assert.equal(workspaceJson.preflight.git.status, "ok")
    assert.equal(workspaceJson.preflight.github.status, "ok")
    assert.equal(workspaceJson.preflight.github.owner, "acme")
    assert.equal(workspaceJson.preflight.github.repo, "demo")
    assert.equal(workspaceJson.reviewPolicy.coderabbit.enabled, false)
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.enabled, true)
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.organization, "acme")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.projectKey, "acme_demo")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.region, "eu")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.planTier, "unknown")

    const sonarProperties = readFileSync(join(path, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=acme_demo/)
    assert.match(sonarProperties, /sonar.organization=acme/)
    assert.match(sonarProperties, /sonar\.sources=apps,packages/)
    const sonarWorkflow = readFileSync(join(path, ".github", "workflows", "sonar.yml"), "utf8")
    assert.match(sonarWorkflow, /SonarCloud Scan/)
    const coderabbit = readFileSync(join(path, ".coderabbit.yaml"), "utf8")
    assert.match(coderabbit, /profile: chill/)
    const gitignore = readFileSync(join(path, ".gitignore"), "utf8")
    assert.match(gitignore, /\.env\.local/)
    assert.match(gitignore, /\.beerengineer\/runs\//)

    const dbWorkspace = repos.getWorkspaceByKey("demo")
    assert.equal(dbWorkspace?.sonar_enabled, 1)
    assert.equal(JSON.parse(dbWorkspace?.harness_profile_json ?? "{}").mode, "fast")
    assert.equal(result.preflight.github.status, "ok")
    assert.equal(result.coderabbitInstallUrl?.includes("coderabbit"), true)
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
    assert.deepEqual(config?.reviewPolicy, {
      coderabbit: { enabled: false },
      sonarcloud: { enabled: false },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

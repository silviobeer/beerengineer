import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import {
  generateSonarMcpSnippet,
  generateSonarProjectUrl,
  initGit,
  previewWorkspace,
  registerWorkspace,
  runWorkspacePreflight,
  validateHarnessProfile,
} from "../src/core/workspaces.js"
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
    mkdirSync(join(path, "apps", "engine"), { recursive: true })
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({
        name: "demo",
        private: true,
        scripts: {
          coverage: "npm run coverage --workspaces --if-present",
        },
      }, null, 2),
    )
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
    // CodeRabbit CLI is detected by preflight; enabled tracks CLI availability
    assert.equal(workspaceJson.reviewPolicy.coderabbit.enabled, result.preflight.coderabbit.status === "ok")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.enabled, true)
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.organization, "acme")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.projectKey, "acme_demo")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.region, "eu")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.planTier, "unknown")

    const sonarProperties = readFileSync(join(path, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=acme_demo/)
    assert.match(sonarProperties, /sonar.organization=acme/)
    assert.match(sonarProperties, /sonar\.sources=apps/)
    assert.match(sonarProperties, /sonar\.javascript\.lcov\.reportPaths=coverage\/\*\*\/lcov\.info/)
    assert.match(sonarProperties, /sonar\.test\.inclusions=\*\*\/\*\.test\.ts,\*\*\/\*\.spec\.ts,\*\*\/\*\.test\.tsx,\*\*\/\*\.spec\.tsx/)
    const sonarWorkflow = readFileSync(join(path, ".github", "workflows", "sonar.yml"), "utf8")
    assert.match(sonarWorkflow, /SonarCloud Scan/)
    const coderabbit = readFileSync(join(path, ".coderabbit.yaml"), "utf8")
    assert.match(coderabbit, /profile: chill/)
    const gitignore = readFileSync(join(path, ".gitignore"), "utf8")
    assert.match(gitignore, /\.env\.local/)
    assert.match(gitignore, /\.beerengineer\/workspaces\//)
    assert.match(gitignore, /\.beerengineer\/worktrees\//)

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

test("registerWorkspace omits LCOV import when no JS/TS coverage producer is detected", async () => {
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
    const path = join(dir, "demo-no-coverage")
    mkdirSync(join(path, "apps", "api"), { recursive: true })
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({
        name: "demo-no-coverage",
        private: true,
      }, null, 2),
    )
    const gitInit = await initGit(path, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)
    const remoteAdd = spawnSync("git", ["remote", "add", "origin", "git@github.com:acme/demo-no-coverage.git"], { cwd: path, encoding: "utf8" })
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

    const sonarProperties = readFileSync(join(path, "sonar-project.properties"), "utf8")
    assert.doesNotMatch(sonarProperties, /sonar\.javascript\.lcov\.reportPaths=/)
    assert.equal(result.sonarReadiness.coverage, "not-configured")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runWorkspacePreflight falls back to Basic auth after Bearer 401 for self-hosted sonar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const prevToken = process.env.SONAR_TOKEN
  const prevFetch = globalThis.fetch
  process.env.SONAR_TOKEN = "test-token"
  const authHeaders: string[] = []
  globalThis.fetch = (async (input, init) => {
    authHeaders.push(String((init?.headers as Record<string, string> | undefined)?.authorization ?? ""))
    const url = String(input)
    if (url.includes("/api/authentication/validate")) {
      if (authHeaders.length === 1) return new Response("unauthorized", { status: 401 })
      return new Response(JSON.stringify({ valid: true }), { status: 200, headers: { "content-type": "application/json" } })
    }
    return new Response("ok", { status: 200 })
  }) as typeof fetch

  try {
    const report = await runWorkspacePreflight(dir, { sonarHostUrl: "https://sonarqube.example.com", sonarEnabled: true })
    assert.equal(report.report.sonar.status, "missing")
    assert.equal(report.report.sonar.tokenValid, true)
    assert.equal(authHeaders[0], "Bearer test-token")
    assert.match(authHeaders[1] ?? "", /^Basic /)
  } finally {
    globalThis.fetch = prevFetch
    if (prevToken === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = prevToken
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runWorkspacePreflight reports scanner readiness from PATH", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const stubBin = join(dir, "bin")
  mkdirSync(stubBin, { recursive: true })
  writeFileSync(join(stubBin, "sonar-scanner"), "#!/bin/sh\necho 'SonarScanner 9.9.0'\n", "utf8")
  chmodSync(join(stubBin, "sonar-scanner"), 0o755)
  const prevPath = process.env.PATH
  process.env.PATH = `${stubBin}:${prevPath ?? ""}`

  try {
    const report = await runWorkspacePreflight(dir)
    assert.equal(report.report.sonar.readiness?.scanner, "ok")
    assert.match(report.report.sonar.readiness?.details?.scanner ?? "", /SonarScanner 9\.9\.0/)
  } finally {
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("generateSonarMcpSnippet emits Codex TOML for cloud and self-hosted sonar", () => {
  const cloud = generateSonarMcpSnippet({
    enabled: true,
    organization: "acme",
    hostUrl: "https://sonarcloud.io",
  })
  assert.equal(
    cloud,
    [
      "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
      "[mcp_servers.sonarqube]",
      'command = "docker"',
      'args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_ORG", "mcp/sonarqube"]',
      'env = { "SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>", "SONARQUBE_ORG" = "acme" }',
    ].join("\n"),
  )

  const selfHosted = generateSonarMcpSnippet({
    enabled: true,
    hostUrl: "https://sonarqube.example.com",
  })
  assert.equal(
    selfHosted,
    [
      "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
      "[mcp_servers.sonarqube]",
      'command = "docker"',
      'args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_URL", "mcp/sonarqube"]',
      'env = { "SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>", "SONARQUBE_URL" = "https://sonarqube.example.com" }',
    ].join("\n"),
  )

  const usCloud = generateSonarMcpSnippet({
    enabled: true,
    organization: "acme",
    hostUrl: "https://sonarqube.us",
  })
  assert.equal(
    usCloud,
    [
      "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
      "[mcp_servers.sonarqube]",
      'command = "docker"',
      'args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_ORG", "-e", "SONARQUBE_URL", "mcp/sonarqube"]',
      'env = { "SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>", "SONARQUBE_ORG" = "acme", "SONARQUBE_URL" = "https://sonarqube.us" }',
    ].join("\n"),
  )

  assert.equal(generateSonarMcpSnippet({ enabled: false }), undefined)
})

test("generateSonarProjectUrl only deep-links for SonarCloud projects", () => {
  assert.match(
    generateSonarProjectUrl("demo", {
      enabled: true,
      organization: "acme",
      projectKey: "acme_demo",
      hostUrl: "https://sonarcloud.io",
    }) ?? "",
    /https:\/\/sonarcloud\.io\/projects\/create\?/,
  )
  assert.equal(
    generateSonarProjectUrl("demo", {
      enabled: true,
      organization: "acme",
      projectKey: "acme_demo",
      hostUrl: "https://sonarqube.example.com",
    }),
    undefined,
  )
})

test("workspace preflight and preview prefer origin HEAD over current story branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const path = join(dir, "demo")
    mkdirSync(path, { recursive: true })

    const gitInit = await initGit(path, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)
    assert.equal(spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: path, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["checkout", "-b", "story/demo__proj__w1__branching"], { cwd: path, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: path, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: path, encoding: "utf8" }).status, 0)

    const preview = await previewWorkspace(path, config, repos)
    assert.equal(preview.defaultBranch, "main")

    const preflight = await runWorkspacePreflight(path)
    assert.equal(preflight.report.github.defaultBranch, "main")
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

// Regression: readWorkspaceConfig used to return null for workspaces written
// with claude-sdk-first / codex-sdk-first because isValidHarnessProfile's
// allowlist hadn't been updated. That broke previewWorkspace, openWorkspace,
// and any restart/resume flow that reloads the saved config.
for (const mode of ["claude-sdk-first", "codex-sdk-first"] as const) {
  test(`readWorkspaceConfig round-trips workspaces persisted with ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), `be2-workspaces-${mode}-`))
    try {
      const root = join(dir, "ws")
      mkdirSync(join(root, ".beerengineer"), { recursive: true })
      writeFileSync(
        join(root, ".beerengineer", "workspace.json"),
        JSON.stringify({
          schemaVersion: 2,
          key: "ws",
          name: "ws",
          harnessProfile: { mode },
          runtimePolicy: {
            stageAuthoring: "safe-readonly",
            reviewer: "safe-readonly",
            coderExecution: "safe-workspace-write",
          },
          sonar: { enabled: false },
          reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
          createdAt: 123,
        }, null, 2),
      )

      const config = await import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(root))
      assert.ok(config, `readWorkspaceConfig should not return null for ${mode}`)
      assert.equal(config?.harnessProfile.mode, mode)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

// Regression: a self-mode profile that asked for `merge-resolver: sdk` used
// to validate fine and only fail at conflict-resolution time, where the
// resolver is sync and only dispatches to CLI adapters. Validation now
// rejects it up front.
test("validateHarnessProfile rejects self mode with merge-resolver: sdk", async () => {
  const { validateHarnessProfile } = await import("../src/core/workspaces.js")
  const result = validateHarnessProfile(
    {
      mode: "self",
      roles: {
        coder: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "sdk" },
        reviewer: { harness: "codex", provider: "openai", model: "gpt-5.4", runtime: "cli" },
        "merge-resolver": { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "sdk" },
      },
    },
    { groups: [] } as never,
  )
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "profile_references_unavailable_runtime")
  assert.match(result.error?.detail ?? "", /merge-resolver/)
})

// Regression: merge resolver used to silently fall back to CLI when called
// with runtime: "sdk". Now it reports a clear, actionable failure.
test("resolveMergeConflictsViaLlm refuses sdk runtime with an actionable reason", async () => {
  const { resolveMergeConflictsViaLlm } = await import("../src/core/mergeResolver.js")
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-resolver-sdk-"))
  try {
    const result = resolveMergeConflictsViaLlm({
      workspaceRoot: dir,
      mergeMessage: "test",
      harness: { harness: "claude", runtime: "sdk", model: "claude-sonnet-4-6" },
    })
    assert.equal(result.ok, false)
    assert.match(result.reason, /sdk is not implemented/)
    assert.match(result.reason, /merge-resolver/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
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
import { getSecretMetadata, storeSecret } from "../src/setup/secretStore.js"
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

function readyReportWithOpenCode(): SetupReport {
  const report = readyReport()
  const openCode = report.groups.find(group => group.id === "llm.opencode")
  assert.ok(openCode)
  openCode.passed = 2
  openCode.satisfied = true
  openCode.ideal = true
  openCode.checks = [
    { id: "llm.opencode.cli", label: "OpenCode CLI", status: "ok" },
    { id: "llm.opencode.auth", label: "OpenCode auth", status: "ok" },
  ]
  return report
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

test("registerWorkspace persists execution-only opencode overrides and rejects unsupported execution override runtimes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-opencode-self-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const config = { ...defaultAppConfig(), allowedRoots: [dir] }
  const report = readyReportWithOpenCode()
  const claudeRole = { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "cli" } as const
  const codexRole = { harness: "codex", provider: "openai", model: "gpt-5.4", runtime: "cli" } as const
  const opencodeRole = { harness: "opencode", provider: "openrouter", model: "qwen/qwen3-coder-plus", runtime: "cli" } as const
  const profiles = [
    {
      key: "coder-opencode",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: claudeRole,
          reviewer: claudeRole,
        },
        stageOverrides: {
          execution: {
            coder: opencodeRole,
          },
        },
      },
      expectedExecution: { coder: opencodeRole },
    },
    {
      key: "reviewer-opencode",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: claudeRole,
          reviewer: claudeRole,
        },
        stageOverrides: {
          execution: {
            reviewer: opencodeRole,
          },
        },
      },
      expectedExecution: { reviewer: opencodeRole },
    },
    {
      key: "merge-opencode",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: claudeRole,
          reviewer: codexRole,
          "merge-resolver": claudeRole,
        },
        stageOverrides: {
          execution: {
            "merge-resolver": opencodeRole,
          },
        },
      },
      expectedExecution: { "merge-resolver": opencodeRole },
    },
    {
      key: "all-opencode",
      harnessProfile: {
        mode: "self",
        roles: {
          coder: claudeRole,
          reviewer: codexRole,
          "merge-resolver": claudeRole,
        },
        stageOverrides: {
          execution: {
            coder: opencodeRole,
            reviewer: opencodeRole,
            "merge-resolver": opencodeRole,
          },
        },
      },
      expectedExecution: { coder: opencodeRole, reviewer: opencodeRole, "merge-resolver": opencodeRole },
    },
  ] as const

  try {
    const repos = new Repos(db)
    for (const entry of profiles) {
      const path = join(dir, entry.key)
      const result = await registerWorkspace(
        {
          path,
          key: entry.key,
          harnessProfile: entry.harnessProfile,
          sonar: { enabled: false },
          git: { init: false },
        },
        { repos, config, appReport: report },
      )
      assert.equal(result.ok, true, entry.key)
      const persisted = JSON.parse(readFileSync(join(path, ".beerengineer", "workspace.json"), "utf8")) as {
        harnessProfile: {
          mode: string
          roles: Record<string, unknown>
          stageOverrides?: { execution?: Record<string, unknown> }
        }
      }
      assert.equal(persisted.harnessProfile.mode, "self")
      assert.deepEqual(persisted.harnessProfile.roles, entry.harnessProfile.roles)
      assert.deepEqual(persisted.harnessProfile.stageOverrides?.execution, entry.expectedExecution)
    }

    for (const [label, harnessProfile] of [
      [
        "top-level coder opencode",
        {
          mode: "self",
          roles: {
            coder: opencodeRole,
            reviewer: claudeRole,
          },
        },
      ],
      [
        "opencode preset mode",
        {
          mode: "opencode",
          roles: {
            coder: { provider: "openrouter", model: "qwen/qwen3-coder-plus" },
            reviewer: { provider: "openrouter", model: "deepseek/deepseek-v4-pro" },
          },
        },
      ],
      [
        "coder sdk",
        {
          mode: "self",
          roles: {
            coder: claudeRole,
            reviewer: claudeRole,
          },
          stageOverrides: {
            execution: {
              coder: { ...opencodeRole, runtime: "sdk" },
            },
          },
        },
      ],
      [
        "reviewer sdk",
        {
          mode: "self",
          roles: {
            coder: claudeRole,
            reviewer: claudeRole,
          },
          stageOverrides: {
            execution: {
              reviewer: { ...opencodeRole, runtime: "sdk" },
            },
          },
        },
      ],
      [
        "merge-resolver sdk",
        {
          mode: "self",
          roles: {
            coder: claudeRole,
            reviewer: codexRole,
            "merge-resolver": claudeRole,
          },
          stageOverrides: {
            execution: {
              "merge-resolver": { ...opencodeRole, runtime: "sdk" },
            },
          },
        },
      ],
    ] as const) {
      const key = label.replaceAll(/[^a-z]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()
      const path = join(dir, key)
      const result = await registerWorkspace(
        {
          path,
          key,
          harnessProfile,
          sonar: { enabled: false },
          git: { init: false },
        },
        { repos, config, appReport: report },
      )
      assert.equal(result.ok, false, label)
      if (label.includes("sdk")) {
        assert.equal(result.error, "profile_references_unavailable_runtime")
        assert.match(result.detail ?? "", /opencode:sdk/)
      } else {
        assert.equal(result.error, "unsupported_harness_selection")
        assert.match(result.detail ?? "", /coder/)
      }
      assert.equal(existsSync(join(path, ".beerengineer", "workspace.json")), false)
    }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
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
    assert.equal(workspaceJson.runtimePolicy.coderExecution, "unsafe-autonomous-write")
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
    assert.match(sonarProperties, /sonar\.test\.inclusions=\*\*\/\*\.test\.js,\*\*\/\*\.spec\.js,\*\*\/\*\.test\.jsx,\*\*\/\*\.spec\.jsx,\*\*\/\*\.test\.ts,\*\*\/\*\.spec\.ts,\*\*\/\*\.test\.tsx,\*\*\/\*\.spec\.tsx/)
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

test("registerWorkspace preserves explicit Sonar organization and project key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const path = join(dir, "demo-custom-sonar")
    mkdirSync(join(path, "apps", "api"), { recursive: true })
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "demo-custom-sonar", private: true }), "utf8")
    const gitInit = await initGit(path, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)
    const remoteAdd = spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo-custom-sonar.git"], { cwd: path, encoding: "utf8" })
    assert.equal(remoteAdd.status, 0)

    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true, organization: "sonar-org", projectKey: "custom_key" },
      },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return

    const workspaceJson = JSON.parse(readFileSync(join(path, ".beerengineer", "workspace.json"), "utf8")) as {
      sonar: { organization?: string; projectKey?: string }
      reviewPolicy: { sonarcloud: { organization?: string; projectKey?: string } }
    }
    assert.equal(workspaceJson.sonar.organization, "sonar-org")
    assert.equal(workspaceJson.sonar.projectKey, "custom_key")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.organization, "sonar-org")
    assert.equal(workspaceJson.reviewPolicy.sonarcloud.projectKey, "custom_key")

    const sonarProperties = readFileSync(join(path, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=custom_key/)
    assert.match(sonarProperties, /sonar.organization=sonar-org/)
    assert.doesNotMatch(sonarProperties, /sonar.projectKey=acme_demo-custom-sonar/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("registerWorkspace persists SONAR_TOKEN to the app secret store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const prevStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(dir, "secrets.json")
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const path = join(dir, "demo-shared-token")
    mkdirSync(join(path, "apps", "api"), { recursive: true })
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({
        name: "demo-shared-token",
        private: true,
      }, null, 2),
    )
    const gitInit = await initGit(path, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)

    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true },
        sonarToken: { value: "persisted-token", persist: true },
      },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.match(result.actions.join("\n"), /beerengineer secret store/)
    const persisted = getSecretMetadata("SONAR_TOKEN")
    assert.equal(persisted.present, true)
    assert.equal(persisted.active, true)
  } finally {
    if (prevStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = prevStorePath
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runWorkspacePreflight falls back to Basic auth after Bearer 401 for self-hosted sonar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const prevToken = process.env.SONAR_TOKEN
  const prevStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  const prevFetch = globalThis.fetch
  delete process.env.SONAR_TOKEN
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(dir, "secrets.json")
  storeSecret("SONAR_TOKEN", "test-token")
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
    if (prevStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = prevStorePath
    if (prevToken === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = prevToken
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runWorkspacePreflight reads SONAR_TOKEN from repo git config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  const prevToken = process.env.SONAR_TOKEN
  const prevStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  const prevFetch = globalThis.fetch
  delete process.env.SONAR_TOKEN
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(dir, "missing-secrets.json")
  globalThis.fetch = (async input => {
    const url = String(input)
    if (url.includes("/api/authentication/validate")) {
      return new Response(JSON.stringify({ valid: true }), { status: 200, headers: { "content-type": "application/json" } })
    }
    return new Response("ok", { status: 200 })
  }) as typeof fetch

  try {
    const gitInit = await initGit(dir, { defaultBranch: "main", initialCommit: false })
    assert.equal(gitInit.ok, true)
    const config = spawnSync("git", ["config", "--local", "beerengineer.sonarToken", "git-config-token"], {
      cwd: dir,
      encoding: "utf8",
    })
    assert.equal(config.status, 0, config.stderr ?? "")

    const report = await runWorkspacePreflight(dir, { sonarHostUrl: "https://sonarqube.example.com", sonarEnabled: true })
    assert.equal(report.report.sonar.status, "missing")
    assert.equal(report.report.sonar.tokenSource, "git-config")
    assert.equal(report.report.sonar.tokenValid, true)
  } finally {
    globalThis.fetch = prevFetch
    if (prevStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = prevStorePath
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
  process.env.PATH = `${stubBin}${delimiter}${prevPath ?? ""}`

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
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: path, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.name", "test"], { cwd: path, encoding: "utf8" }).status, 0)
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

test("readWorkspaceConfig upgrades codex CLI workspaces with write-capable execution policy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  try {
    const root = join(dir, "legacy-codex")
    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 1,
        key: "legacy-codex",
        name: "Legacy Codex",
        harnessProfile: { mode: "codex-first" },
        sonar: { enabled: false },
        createdAt: 123,
      }, null, 2),
    )

    const config = await import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(root))
    assert.equal(config?.schemaVersion, 2)
    assert.equal(config?.runtimePolicy.coderExecution, "unsafe-autonomous-write")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("readWorkspaceConfig rejects malformed self execution stageOverrides role entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  try {
    const root = join(dir, "invalid-self-overrides")
    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "invalid-self-overrides",
        name: "Invalid Self Overrides",
        harnessProfile: {
          mode: "self",
          roles: {
            coder: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6", runtime: "cli" },
            reviewer: { harness: "codex", provider: "openai", model: "gpt-5.4", runtime: "cli" },
          },
          stageOverrides: {
            execution: {
              coder: [],
            },
          },
        },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "unsafe-autonomous-write",
        },
        sonar: { enabled: false },
        reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
        createdAt: 123,
      }, null, 2),
    )

    const config = await import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(root))
    assert.equal(config, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("registerWorkspace rejects non-boolean rerere config values visibly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-rerere-invalid-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const path = join(dir, "demo")
    mkdirSync(join(path, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(path, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "demo",
        name: "Demo",
        harnessProfile: { mode: "fast" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "unsafe-autonomous-write",
        },
        sonar: { enabled: false },
        reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
        git: { rerere: "true" },
        createdAt: 123,
      }, null, 2),
    )

    const result = await registerWorkspace(
      {
        path,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: false },
        git: { init: false },
      },
      { repos, config, appReport: readyReport() },
    )

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error, "workspace_config_invalid")
    assert.match(result.detail, /git\.rerere/i)
    assert.match(result.detail, /boolean/i)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("readWorkspaceConfig defaults autoPromoteOnGreenQa to true and preserves explicit false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspaces-"))
  try {
    const enabledRoot = join(dir, "enabled")
    mkdirSync(join(enabledRoot, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(enabledRoot, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "enabled",
        name: "Enabled",
        harnessProfile: { mode: "fast" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "unsafe-autonomous-write",
        },
        sonar: { enabled: false },
        reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
        createdAt: 123,
      }, null, 2),
    )

    const disabledRoot = join(dir, "disabled")
    mkdirSync(join(disabledRoot, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(disabledRoot, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "disabled",
        name: "Disabled",
        harnessProfile: { mode: "fast" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "unsafe-autonomous-write",
        },
        sonar: { enabled: false },
        reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
        autoPromoteOnGreenQa: false,
        createdAt: 123,
      }, null, 2),
    )

    const [enabledConfig, disabledConfig] = await Promise.all([
      import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(enabledRoot)),
      import("../src/core/workspaces.js").then(mod => mod.readWorkspaceConfig(disabledRoot)),
    ])

    assert.equal(enabledConfig?.autoPromoteOnGreenQa, true)
    assert.equal(disabledConfig?.autoPromoteOnGreenQa, false)
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

test("resolveMergeConflictsViaLlm supports opencode for merge resolution", async () => {
  const { resolveMergeConflictsViaLlm } = await import("../src/core/mergeResolver.js")
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-resolver-opencode-"))
  const binDir = join(dir, "bin")
  const repoDir = join(dir, "repo")
  const previousPath = process.env.PATH
  try {
    mkdirSync(binDir, { recursive: true })
    mkdirSync(repoDir, { recursive: true })
    spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoDir, encoding: "utf8" })
    writeFileSync(join(repoDir, "README.md"), "base\n", "utf8")
    spawnSync("git", ["add", "README.md"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["commit", "-m", "base"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["checkout", "-b", "feature"], { cwd: repoDir, encoding: "utf8" })
    writeFileSync(join(repoDir, "README.md"), "feature\n", "utf8")
    spawnSync("git", ["commit", "-am", "feature"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["checkout", "main"], { cwd: repoDir, encoding: "utf8" })
    writeFileSync(join(repoDir, "README.md"), "main\n", "utf8")
    spawnSync("git", ["commit", "-am", "main"], { cwd: repoDir, encoding: "utf8" })
    spawnSync("git", ["merge", "feature"], { cwd: repoDir, encoding: "utf8" })

    const stubPath = join(binDir, "opencode")
    writeFileSync(stubPath, `#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
cat <<'EOF' > README.md
resolved
EOF
printf '%s\n' '{"type":"step_start","sessionID":"merge-123"}'
printf '%s\n' '{"type":"text","part":{"text":"{\\"summary\\":\\"resolved\\",\\"resolvedFiles\\":[\\"README.md\\"]}"}}'
printf '%s\n' '{"type":"step_finish","part":{"tokens":{"input":9,"output":11}}}'
`, "utf8")
    chmodSync(stubPath, 0o755)
    process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`

    const result = resolveMergeConflictsViaLlm({
      workspaceRoot: repoDir,
      mergeMessage: "test merge",
      harness: { harness: "opencode", provider: "openrouter", model: "qwen/qwen3-coder-plus" },
    })

    assert.equal(result.ok, true)
    assert.equal(readFileSync(join(repoDir, "README.md"), "utf8"), "resolved\n")
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})

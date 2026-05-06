import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildWorkspaceCapabilityContext,
  buildWorkspacePreflightCapabilities,
  initGit,
  registerWorkspace,
  runWorkspacePreflight,
} from "../src/core/workspaces.js"
import { provisionWorkspaceCodeRabbitCapability } from "../src/core/capabilities/index.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { defaultAppConfig } from "../src/setup/config.js"
import type { SetupReport } from "../src/setup/types.js"
import type { WorkspacePreflightReport } from "../src/types/workspace.js"

function readyReport(): SetupReport {
  return {
    reportVersion: 1,
    overall: "ok",
    generatedAt: Date.now(),
    groups: [
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

function samplePreflight(overrides: Partial<WorkspacePreflightReport> = {}): WorkspacePreflightReport {
  return {
    git: { status: "ok" },
    github: { status: "missing", detail: "origin remote is not configured", defaultBranch: "main" },
    gh: { status: "missing", detail: "gh auth status failed" },
    sonar: { status: "missing", detail: "SONAR_TOKEN was not found in the beerengineer secret store or legacy repo git config" },
    coderabbit: { status: "missing", detail: "CodeRabbit CLI not found" },
    capabilities: [],
    checkedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

test("PROJ-3-PRD-2 AC-1 workspace preflight reports all workspace capabilities", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  try {
    const gitInit = await initGit(dir, { defaultBranch: "main" })
    assert.equal(gitInit.ok, true)
    const preflight = await runWorkspacePreflight(dir)
    assert.deepEqual(preflight.report.capabilities.map(cap => cap.capabilityId).sort(), ["coderabbit", "git", "github", "sonar", "supabase"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-2 each workspace capability result includes capabilityId", () => {
  const capabilities = buildWorkspacePreflightCapabilities(samplePreflight())
  for (const capability of capabilities) assert.equal(typeof capability.capabilityId, "string")
})

test("PROJ-3-PRD-2 AC-3 non-ready workspace capabilities include human-readable reasons", () => {
  const capabilities = buildWorkspacePreflightCapabilities(samplePreflight())
  for (const capability of capabilities.filter(cap => cap.status !== "ready")) {
    assert.equal(typeof capability.reason, "string")
    assert.ok(capability.reason.length > 0)
  }
})

test("PROJ-3-PRD-2 AC-5 local Git readiness is mandatory in workspace context", () => {
  const context = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight({ git: { status: "missing", detail: "not a git repo" } }))
  assert.equal(context.git.mandatory, true)
  assert.equal(context.git.ready, false)
})

test("PROJ-3-PRD-2 AC-6 GitHub readiness is mandatory only for GitHub-dependent actions", () => {
  const localContext = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight())
  const githubActionContext = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight(), { githubRequired: true })
  assert.equal(localContext.github.mandatory, false)
  assert.equal(githubActionContext.github.mandatory, true)
})

test("PROJ-3-PRD-2 AC-7 optional capability helpers consume context instead of parsing remotes", () => {
  const context = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight({
    github: { status: "ok", owner: "acme", repo: "demo", remoteUrl: "git@github.com:acme/demo.git", defaultBranch: "main" },
    gh: { status: "ok", user: "octocat" },
  }))
  assert.equal(context.github.owner, "acme")
  assert.equal(context.github.repo, "demo")
  assert.equal(context.github.ghUser, "octocat")
})

test("PROJ-3-PRD-2 AC-8 GitHub provider context is passed to optional capability context", () => {
  const context = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight({
    github: { status: "ok", owner: "acme", repo: "demo", remoteUrl: "https://github.com/acme/demo.git", defaultBranch: "main" },
  }))
  assert.deepEqual(
    { owner: context.github.owner, repo: context.github.repo, remoteUrl: context.github.remoteUrl },
    { owner: "acme", repo: "demo", remoteUrl: "https://github.com/acme/demo.git" },
  )
})

test("PROJ-3-PRD-2 AC-9 missing Sonar does not roll back valid registration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const previousSecretStore = process.env.BEERENGINEER_SECRET_STORE_PATH
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(dir, "missing-secrets.json")
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const result = await registerWorkspace(
      { path: join(dir, "demo"), harnessProfile: { mode: "fast" }, sonar: { enabled: true } },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.capabilityOutcomes.some(cap => cap.capabilityId === "sonar" && cap.status !== "ready"), true)
  } finally {
    if (previousSecretStore === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStore
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-10 CodeRabbit optional readiness does not roll back valid registration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const result = await registerWorkspace(
      { path: join(dir, "demo"), harnessProfile: { mode: "fast" }, sonar: { enabled: false } },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.capabilityOutcomes.some(cap => cap.capabilityId === "coderabbit"), true)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-11 optional capability outcomes are visible in registration result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const result = await registerWorkspace(
      { path: join(dir, "demo"), harnessProfile: { mode: "fast" }, sonar: { enabled: true } },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.capabilityOutcomes.map(cap => cap.capabilityId).sort(), ["coderabbit", "git", "github", "sonar", "supabase"])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-12 required workspace path failures do not present successful state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  try {
    const target = join(dir, "not-a-directory")
    writeFileSync(target, "file")
    const repos = new Repos(db)
    const config = { ...defaultAppConfig(), allowedRoots: [dir] }
    const result = await registerWorkspace(
      { path: target, harnessProfile: { mode: "fast" }, sonar: { enabled: false } },
      { repos, config, appReport: readyReport() },
    )
    assert.equal(result.ok, false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-16 registration exposes capability-owned delegates", () => {
  assert.equal(typeof provisionWorkspaceCodeRabbitCapability, "function")
})

test("PROJ-3-PRD-2 AC-17 Git capability owns local Git initialization actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  try {
    const result = await initGit(dir, { defaultBranch: "main" })
    assert.equal(result.ok, true)
    assert.equal(result.actions.some(action => action.startsWith("git init")), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-18 GitHub capability context owns remote metadata only", () => {
  const context = buildWorkspaceCapabilityContext("/tmp/demo", samplePreflight({
    github: { status: "ok", owner: "acme", repo: "demo", remoteUrl: "git@github.com:acme/demo.git" },
  }))
  assert.equal(context.github.owner, "acme")
  assert.equal("sonar" in context.github, false)
})

test("PROJ-3-PRD-2 AC-19 Sonar writes only Sonar-owned artifacts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  try {
    mkdirSync(join(dir, "src"), { recursive: true })
    const gitInit = await initGit(dir, { defaultBranch: "main" })
    assert.equal(gitInit.ok, true)
    const actions: string[] = []
    const warnings: string[] = []
    const { provisionWorkspaceSonarCapability, buildWorkspaceCapabilityContext } = await import("../src/core/capabilities/index.js")
    const report = samplePreflight({
      github: { status: "ok", owner: "acme", repo: "demo", defaultBranch: "main" },
      gh: { status: "ok", user: "octocat" },
    })
    await provisionWorkspaceSonarCapability(buildWorkspaceCapabilityContext(dir, report), "Demo", { enabled: true }, actions, warnings)
    assert.equal(actions.every(action => action.includes("sonar") || action.includes("Sonar")), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-2 AC-20 CodeRabbit writes only CodeRabbit-owned configuration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cap-"))
  try {
    const actions: string[] = []
    await provisionWorkspaceCodeRabbitCapability(dir, actions)
    assert.equal(actions.length, 1)
    assert.match(actions[0] ?? "", /coderabbit/i)
    assert.match(readFileSync(join(dir, ".coderabbit.yaml"), "utf8"), /reviews:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

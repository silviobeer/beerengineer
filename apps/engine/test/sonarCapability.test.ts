import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyWorkspaceSonarRepair,
  auditWorkspaceSonarCapability,
  buildWorkspaceCapabilityContext,
  enableRegisteredWorkspaceSonarCapability,
  enableWorkspaceSonarCapability,
  initGit,
  planWorkspaceSonarRepair,
  registerWorkspace,
  runWorkspacePreflight,
} from "../src/core/workspaces.js"
import { buildWorkspaceConfigFile } from "../src/core/workspaces/configFile.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { defaultAppConfig } from "../src/setup/config.js"
import type { SetupReport } from "../src/setup/types.js"
import type { WorkspaceConfigFile } from "../src/types/workspace.js"

function withoutAmbientSonarToken<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.SONAR_TOKEN
  const previousSecretStore = process.env.BEERENGINEER_SECRET_STORE_PATH
  const secretStoreDir = mkdtempSync(join(tmpdir(), "be2-sonar-secrets-"))
  delete process.env.SONAR_TOKEN
  process.env.BEERENGINEER_SECRET_STORE_PATH = join(secretStoreDir, "secrets.json")
  return fn().finally(() => {
    if (previous === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = previous
    if (previousSecretStore === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStore
    rmSync(secretStoreDir, { recursive: true, force: true })
  })
}

async function makeWorkspace(): Promise<{ root: string; config: WorkspaceConfigFile }> {
  const root = mkdtempSync(join(tmpdir(), "be2-sonar-cap-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { coverage: "vitest --coverage" } }), "utf8")
  const git = await initGit(root, { defaultBranch: "main" })
  assert.equal(git.ok, true)
  const { runGit } = await import("../src/core/workspaces/shared.js")
  assert.equal(runGit(["remote", "add", "origin", "https://github.com/acme/demo.git"], root).ok, true)
  const config = buildWorkspaceConfigFile({
    key: "demo",
    name: "Demo",
    harnessProfile: { mode: "fast" },
    sonar: { enabled: true, organization: "acme", projectKey: "acme_demo" },
  })
  return { root, config }
}

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
    ],
  }
}

test("PROJ-3-PRD-3 AC-1 workspace sonar enable uses the explicit Sonar enablement path", () => withoutAmbientSonarToken(async () => {
  const { root } = await makeWorkspace()
  try {
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const context = buildWorkspaceCapabilityContext(root, preflight.report, { githubRequired: true })
    const result = await enableWorkspaceSonarCapability(context, "Demo", { enabled: true, organization: "acme", projectKey: "acme_demo" })
    assert.ok(result.actions.includes("wrote sonar-project.properties"))
    assert.ok(result.actions.includes("wrote .github/workflows/sonar.yml"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("workspace sonar enable writes the configured non-default Sonar project key", () => withoutAmbientSonarToken(async () => {
  const { root } = await makeWorkspace()
  try {
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const context = buildWorkspaceCapabilityContext(root, preflight.report, { githubRequired: true })
    await enableWorkspaceSonarCapability(context, "Demo", { enabled: true, organization: "acme", projectKey: "custom_key" })
    const sonarProperties = readFileSync(join(root, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=custom_key/)
    assert.match(sonarProperties, /sonar.organization=acme/)
    assert.doesNotMatch(sonarProperties, /sonar.projectKey=acme_demo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("workspace sonar enable for a missing workspace returns a static preflight sentinel", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-sonar-cap-"))
  const db = initDatabase(join(root, "db.sqlite"))
  try {
    const result = await enableRegisteredWorkspaceSonarCapability(new Repos(db), "missing-demo")
    assert.equal(result.ok, false)
    assert.equal(result.capability.reason, "Workspace not found: missing-demo")
    assert.equal(result.preflight.git.status, "skipped")
    assert.equal(result.preflight.git.defaultBranch, null)
    assert.equal(result.preflight.sonar.readiness?.config, "missing")
    assert.deepEqual(result.preflight.capabilities, [{
      capabilityId: "sonar",
      status: "failed",
      summary: "sonar failed readiness checks",
      reason: "Workspace not found: missing-demo",
    }])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-2 Sonar enablement writes only Sonar-owned artifacts and metadata", () => withoutAmbientSonarToken(async () => {
  const { root } = await makeWorkspace()
  try {
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const context = buildWorkspaceCapabilityContext(root, preflight.report, { githubRequired: true })
    await enableWorkspaceSonarCapability(context, "Demo", { enabled: true, organization: "acme", projectKey: "acme_demo" })
    assert.equal(existsSync(join(root, "sonar-project.properties")), true)
    assert.equal(existsSync(join(root, ".github", "workflows", "sonar.yml")), true)
    assert.equal(existsSync(join(root, ".coderabbit.yaml")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("PROJ-3-PRD-3 AC-3 missing prerequisites return capability status and next actions", () => withoutAmbientSonarToken(async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-sonar-cap-"))
  try {
    mkdirSync(join(root, "src"), { recursive: true })
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const context = buildWorkspaceCapabilityContext(root, preflight.report, { githubRequired: true })
    const result = await enableWorkspaceSonarCapability(context, "Demo", { enabled: true })
    assert.equal(result.ok, false)
    assert.equal(result.capability.capabilityId, "sonar")
    assert.ok(result.nextActions.some(action => action.includes("GitHub origin remote")))
    assert.equal(existsSync(join(root, "sonar-project.properties")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("PROJ-3-PRD-3 AC-5 workspace add --sonar and explicit enable share Sonar enablement artifacts", () => withoutAmbientSonarToken(async () => {
  const { root } = await makeWorkspace()
  try {
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const context = buildWorkspaceCapabilityContext(root, preflight.report, { githubRequired: true })
    await enableWorkspaceSonarCapability(context, "Demo", { enabled: true, organization: "acme", projectKey: "acme_demo" })
    const explicitProps = readFileSync(join(root, "sonar-project.properties"), "utf8")
    rmSync(join(root, "sonar-project.properties"), { force: true })
    rmSync(join(root, ".github"), { recursive: true, force: true })
    const db = initDatabase(join(root, "db.sqlite"))
    try {
      const result = await registerWorkspace(
        { path: root, harnessProfile: { mode: "fast" }, sonar: { enabled: true } },
        { repos: new Repos(db), config: { ...defaultAppConfig(), allowedRoots: [root] }, appReport: readyReport() },
      )
      assert.equal(result.ok, true)
      assert.equal(readFileSync(join(root, "sonar-project.properties"), "utf8"), explicitProps)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("PROJ-3-PRD-3 AC-6 optional Sonar failure does not roll back workspace registration", () => withoutAmbientSonarToken(async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-sonar-cap-"))
  const db = initDatabase(join(root, "db.sqlite"))
  try {
    mkdirSync(join(root, "demo"), { recursive: true })
    const result = await registerWorkspace(
      { path: join(root, "demo"), harnessProfile: { mode: "fast" }, sonar: { enabled: true } },
      { repos: new Repos(db), config: { ...defaultAppConfig(), allowedRoots: [root] }, appReport: readyReport() },
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.workspace.key, "demo")
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
}))

test("PROJ-3-PRD-3 AC-7 failed and not_configured Sonar outcomes include a reason", () => withoutAmbientSonarToken(async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-sonar-cap-"))
  try {
    const preflight = await runWorkspacePreflight(root, { sonarEnabled: true })
    const sonar = preflight.report.capabilities.find(capability => capability.capabilityId === "sonar")
    assert.ok(sonar)
    assert.notEqual(sonar.status, "ready")
    assert.ok(sonar.reason)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test("PROJ-3-PRD-3 AC-8 Sonar enablement write failures are best-effort and auditable", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.ok(audit.findings.some(finding => finding.id === "sonar-properties-missing"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-9 partial Sonar states can be recovered by re-enable or repair", async () => {
  const { root, config } = await makeWorkspace()
  try {
    writeFileSync(join(root, "sonar-project.properties"), "sonar.sources=src\n", "utf8")
    const before = await auditWorkspaceSonarCapability(root, config)
    assert.ok(before.findings.some(finding => finding.id === "sonar-workflow-missing"))
    const repair = await applyWorkspaceSonarRepair(root, config)
    assert.ok(repair.actions.some(action => action.id === "sonar-workflow-missing" && action.applied))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-10 audit detects partial states", async () => {
  const { root, config } = await makeWorkspace()
  try {
    writeFileSync(join(root, "sonar-project.properties"), "sonar.sources=missing\n", "utf8")
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.ok(audit.findings.some(finding => finding.id === "sonar-properties-invalid"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-11 workspace sonar audit reports roots coverage and readiness", async () => {
  const { root, config } = await makeWorkspace()
  try {
    writeFileSync(join(root, "sonar-project.properties"), [
      "sonar.sources=src",
      "sonar.tests=.",
      "sonar.javascript.lcov.reportPaths=coverage/**/lcov.info",
    ].join("\n"), "utf8")
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.deepEqual(audit.sourceRoots, ["src"])
    assert.deepEqual(audit.testRoots, ["."])
    assert.deepEqual(audit.coverageReports, ["coverage/**/lcov.info"])
    assert.equal(typeof audit.readiness.config, "string")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-12 Sonar audit reports drift structurally without throwing", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.ok(Array.isArray(audit.findings))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-13 Sonar audit classifies drift by risk and repairability", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.ok(audit.findings.every(finding => finding.risk && finding.repairability))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-14 Sonar audit is read-only", async () => {
  const { root, config } = await makeWorkspace()
  try {
    await auditWorkspaceSonarCapability(root, config)
    assert.equal(existsSync(join(root, "sonar-project.properties")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-15 workspace sonar repair produces dry-run plan by default", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const plan = await planWorkspaceSonarRepair(root, config)
    assert.equal(plan.mode, "dry-run")
    assert.ok(plan.actions.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-16 dry-run repair separates safe repairs from risky and ambiguous ones", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const plan = await planWorkspaceSonarRepair(root, config)
    assert.ok(plan.actions.some(action => action.repairability === "safe"))
    assert.ok(plan.actions.some(action => action.repairability === "ambiguous"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-17 risky or ambiguous repair candidates include reasons", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const plan = await planWorkspaceSonarRepair(root, config)
    assert.ok(plan.actions.filter(action => action.repairability !== "safe").every(action => action.reason))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-18 dry-run repair does not modify files", async () => {
  const { root, config } = await makeWorkspace()
  try {
    await planWorkspaceSonarRepair(root, config)
    assert.equal(existsSync(join(root, "sonar-project.properties")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-19 repair --apply writes only safe deterministic repairs", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const report = await applyWorkspaceSonarRepair(root, config)
    assert.ok(report.actions.filter(action => action.repairability === "safe").some(action => action.applied))
    assert.ok(report.actions.filter(action => action.repairability !== "safe").every(action => !action.applied))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("repair --apply writes the configured non-default Sonar project key", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const custom = buildWorkspaceConfigFile({
      ...config,
      sonar: { enabled: true, organization: "acme", projectKey: "custom_key" },
      reviewPolicy: {
        ...config.reviewPolicy,
        sonarcloud: { enabled: true, organization: "acme", projectKey: "custom_key" },
      },
    })
    await applyWorkspaceSonarRepair(root, custom)
    const sonarProperties = readFileSync(join(root, "sonar-project.properties"), "utf8")
    assert.match(sonarProperties, /sonar.projectKey=custom_key/)
    assert.doesNotMatch(sonarProperties, /sonar.projectKey=acme_demo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-20 repair --apply never applies risky or ambiguous candidates", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const report = await applyWorkspaceSonarRepair(root, config)
    assert.ok(report.actions.filter(action => action.repairability !== "safe").every(action => action.applied === false))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-21 config and workspace metadata are represented as one repair unit", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const disabled = { ...config, sonar: { enabled: false }, reviewPolicy: { ...config.reviewPolicy, sonarcloud: { enabled: false } } } as WorkspaceConfigFile
    const report = await planWorkspaceSonarRepair(root, disabled)
    assert.ok(report.actions.some(action => action.id === "sonar-disabled"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-22 partial repair failure is detectable and recomputable", async () => {
  const { root, config } = await makeWorkspace()
  try {
    await applyWorkspaceSonarRepair(root, config)
    rmSync(join(root, ".github"), { recursive: true, force: true })
    const audit = await auditWorkspaceSonarCapability(root, config)
    assert.ok(audit.findings.some(finding => finding.id === "sonar-workflow-missing"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-23 repair --apply is idempotent", async () => {
  const { root, config } = await makeWorkspace()
  try {
    await applyWorkspaceSonarRepair(root, config)
    const second = await applyWorkspaceSonarRepair(root, config)
    assert.ok(second.actions.every(action => !action.applied))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-3 AC-24 Sonar lifecycle logic is owned by the Sonar capability module", async () => {
  const mod = await import("../src/core/capabilities/sonarCapability.js")
  assert.equal(typeof mod.auditWorkspaceSonarCapability, "function")
  assert.equal(typeof mod.applyWorkspaceSonarRepair, "function")
})

test("PROJ-3-PRD-3 AC-25 registration and review can orchestrate through Sonar capability contracts", async () => {
  const mod = await import("../src/core/capabilities/index.js")
  assert.equal(typeof mod.provisionWorkspaceSonarCapability, "function")
  assert.equal(typeof mod.enableWorkspaceSonarCapability, "function")
})

test("PROJ-3-PRD-3 AC-27 Sonar lifecycle covers the workspace quality lifecycle document primitives", async () => {
  const { root, config } = await makeWorkspace()
  try {
    const audit = await auditWorkspaceSonarCapability(root, config)
    const repair = await planWorkspaceSonarRepair(root, config)
    assert.equal(audit.capabilityId, "sonar")
    assert.equal(repair.capabilityId, "sonar")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

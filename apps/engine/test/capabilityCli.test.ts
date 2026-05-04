import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { capabilityExitCode } from "../src/cli/capabilityExitCodes.js"
import { renderCapabilityJson, renderCapabilityText } from "../src/cli/commands/capabilityRenderers.js"
import { parseArgs } from "../src/index.js"
import { writeWorkspaceConfig } from "../src/core/workspaces.js"
import { buildWorkspaceConfigFile } from "../src/core/workspaces/configFile.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

function seedWorkspace(root: string, dbPath: string): void {
  mkdirSync(join(root, "src"), { recursive: true })
  const db = initDatabase(dbPath)
  try {
    const repos = new Repos(db)
    repos.upsertWorkspace({
      key: "demo",
      name: "Demo",
      rootPath: root,
      harnessProfileJson: JSON.stringify({ mode: "fast" }),
      sonarEnabled: true,
    })
  } finally {
    db.close()
  }
}

async function writeDemoConfig(root: string): Promise<void> {
  await writeWorkspaceConfig(root, buildWorkspaceConfigFile({
    key: "demo",
    name: "Demo",
    harnessProfile: { mode: "fast" },
    sonar: { enabled: true, organization: "acme", projectKey: "acme_demo" },
  }))
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  return spawnSync(process.execPath, [resolve(engineRoot, "bin/beerengineer.js"), ...args], {
    cwd: engineRoot,
    encoding: "utf8",
    env,
  })
}

test("PROJ-3-PRD-5 AC-1 public command groups use stable capability names", () => {
  assert.equal(parseArgs(["workspace", "git", "status", "demo"]).kind, "workspace-git-status")
  assert.equal(parseArgs(["workspace", "github", "status", "demo"]).kind, "workspace-github-status")
  assert.equal(parseArgs(["workspace", "sonar", "audit", "demo"]).kind, "workspace-sonar-audit")
  assert.equal(parseArgs(["workspace", "coderabbit", "status", "demo"]).kind, "workspace-coderabbit-status")
})

test("PROJ-3-PRD-5 AC-2 no generic workspace capability command is introduced", () => {
  assert.deepEqual(parseArgs(["workspace", "capability", "sonar", "audit", "demo"]), {
    kind: "unknown",
    token: "workspace capability sonar audit demo",
  })
})

test("PROJ-3-PRD-5 AC-4 commands route to capability behavior", () => {
  assert.equal(parseArgs(["workspace", "sonar", "repair", "demo", "--apply"]).kind, "workspace-sonar-repair")
})

test("PROJ-3-PRD-5 AC-5 JSON output includes capabilityId", () => {
  const rendered = JSON.parse(renderCapabilityJson({ capabilityId: "sonar", status: "ready", summary: "ready" }))
  assert.equal(rendered.capabilityId, "sonar")
})

test("PROJ-3-PRD-5 AC-6 JSON output uses closed status or outcome values", () => {
  const rendered = JSON.parse(renderCapabilityJson({ capabilityId: "coderabbit", outcome: "not_meaningful", summary: "no diff" }))
  assert.equal(rendered.outcome, "not_meaningful")
})

test("PROJ-3-PRD-5 AC-7 text output distinguishes capability states", () => {
  assert.match(renderCapabilityText({ capabilityId: "sonar", status: "not_configured", summary: "missing token" }), /not_configured/)
  assert.match(renderCapabilityText({ capabilityId: "coderabbit", outcome: "not_meaningful", summary: "no diff" }), /not_meaningful/)
})

test("PROJ-3-PRD-5 AC-8 non-ready text output includes reason and next action", () => {
  const text = renderCapabilityText({
    capabilityId: "github",
    status: "failed",
    summary: "GitHub failed readiness checks",
    reason: "origin is not GitHub",
    nextActions: ["Set origin to a GitHub remote"],
  })
  assert.match(text, /reason: origin is not GitHub/)
  assert.match(text, /next: Set origin/)
})

test("PROJ-3-PRD-5 AC-9 workspace sonar audit is available with text and JSON output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cap-cli-"))
  const dbPath = join(dir, "db.sqlite")
  try {
    seedWorkspace(join(dir, "demo"), dbPath)
    await writeDemoConfig(join(dir, "demo"))
    const json = runCli(["workspace", "sonar", "audit", "demo", "--json"], { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath })
    assert.equal(json.status, capabilityExitCode("optionalWarning"))
    assert.equal(JSON.parse(json.stdout).capabilityId, "sonar")
    const text = runCli(["workspace", "sonar", "audit", "demo"], { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath })
    assert.match(text.stdout, /Sonar audit/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-5 AC-10 workspace sonar repair is dry-run by default with text and JSON output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cap-cli-"))
  const dbPath = join(dir, "db.sqlite")
  try {
    seedWorkspace(join(dir, "demo"), dbPath)
    await writeDemoConfig(join(dir, "demo"))
    const json = runCli(["workspace", "sonar", "repair", "demo", "--json"], { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath })
    assert.equal(json.status, capabilityExitCode("optionalWarning"))
    assert.equal(JSON.parse(json.stdout).mode, "dry-run")
    assert.equal(existsSync(join(dir, "demo", "sonar-project.properties")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-5 AC-11 workspace sonar repair --apply writes safe deterministic repairs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cap-cli-"))
  const dbPath = join(dir, "db.sqlite")
  try {
    seedWorkspace(join(dir, "demo"), dbPath)
    await writeDemoConfig(join(dir, "demo"))
    const result = runCli(["workspace", "sonar", "repair", "demo", "--apply", "--json"], { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath })
    assert.equal(result.status, capabilityExitCode("success"), `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(join(dir, "demo", "sonar-project.properties")), true)
    assert.equal(existsSync(join(dir, "demo", ".github", "workflows", "sonar.yml")), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-3-PRD-5 AC-13 capability CLI success exits with 0", () => {
  assert.equal(capabilityExitCode("success"), 0)
})

test("PROJ-3-PRD-5 AC-14 capability CLI usage or workspace errors exit with 20", () => {
  assert.equal(capabilityExitCode("usage"), 20)
})

test("PROJ-3-PRD-5 AC-15 capability CLI transport errors exit with 30", () => {
  assert.equal(capabilityExitCode("transport"), 30)
})

test("PROJ-3-PRD-5 AC-16 required capability failures exit with 40", () => {
  assert.equal(capabilityExitCode("requiredFailure"), 40)
})

test("PROJ-3-PRD-5 AC-17 optional warning states exit with 41", () => {
  assert.equal(capabilityExitCode("optionalWarning"), 41)
})

test("PROJ-3-PRD-5 AC-18 optional warning states do not reuse required failure semantics", () => {
  assert.notEqual(capabilityExitCode("optionalWarning"), capabilityExitCode("requiredFailure"))
})

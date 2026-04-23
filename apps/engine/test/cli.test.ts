import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { main, parseArgs, resolveItemReference, resolveUiLaunchUrl, resolveUiWorkspacePath } from "../src/index.js"
import { resolveConfiguredDbPath } from "../src/setup/config.js"
import { layout } from "../src/core/workspaceLayout.js"

function makeStubBin(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
}

test("parseArgs recognizes help, doctor, start ui, workflow, item action, and unknown commands", () => {
  assert.deepEqual(parseArgs([]), { kind: "workflow", json: false, workspaceKey: undefined })
  assert.deepEqual(parseArgs(["--json"]), { kind: "workflow", json: true, workspaceKey: undefined })
  assert.deepEqual(parseArgs(["run", "--json"]), { kind: "workflow", json: true, workspaceKey: undefined })
  assert.deepEqual(parseArgs(["--workspace", "demo"]), { kind: "workflow", json: false, workspaceKey: "demo" })
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" })
  assert.deepEqual(parseArgs(["-h"]), { kind: "help" })
  assert.deepEqual(parseArgs(["--doctor"]), { kind: "doctor", json: false, group: undefined })
  assert.deepEqual(parseArgs(["doctor", "--json", "--group", "core"]), { kind: "doctor", json: true, group: "core" })
  assert.deepEqual(parseArgs(["setup", "--no-interactive"]), { kind: "setup", group: undefined, noInteractive: true })
  assert.deepEqual(parseArgs(["workspace", "preview", "/tmp/demo", "--json"]), { kind: "workspace-preview", path: "/tmp/demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "add", "--path", "/tmp/demo", "--profile", "fast", "--sonar", "--no-git", "--no-interactive"]), {
    kind: "workspace-add",
    json: false,
    noInteractive: true,
    path: "/tmp/demo",
    name: undefined,
    key: undefined,
    profile: "fast",
    profileJson: undefined,
    sonar: true,
    sonarKey: undefined,
    sonarOrg: undefined,
    sonarHost: undefined,
    sonarToken: undefined,
    sonarTokenPersist: true,
    noGit: true,
    ghCreate: false,
    ghPublic: false,
    ghOwner: undefined,
  })
  assert.deepEqual(parseArgs(["workspace", "list", "--json"]), { kind: "workspace-list", json: true })
  assert.deepEqual(parseArgs(["workspace", "get", "demo", "--json"]), { kind: "workspace-get", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "remove", "demo", "--purge"]), { kind: "workspace-remove", key: "demo", json: false, purge: true })
  assert.deepEqual(parseArgs(["workspace", "open", "demo"]), { kind: "workspace-open", key: "demo" })
  assert.deepEqual(parseArgs(["workspace", "backfill", "--json"]), { kind: "workspace-backfill", json: true })
  assert.deepEqual(parseArgs(["start", "ui"]), { kind: "start-ui" })
  assert.deepEqual(parseArgs(["item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"]), {
    kind: "item-action",
    itemRef: "ITEM-0001",
    action: "start_brainstorm"
  })
  assert.deepEqual(parseArgs(["item", "action"]), { kind: "unknown", token: "item action" })
  assert.deepEqual(parseArgs(["wat"]), { kind: "unknown", token: "wat" })
})

test("doctor --json reports blocked status when the app config is uninitialized", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousConfigPath = process.env.BEERENGINEER_CONFIG_PATH
  const previousDataDir = process.env.BEERENGINEER_DATA_DIR
  const previousPath = process.env.PATH
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const stubBin = join(dir, "bin")

  try {
    const configPath = join(dir, "config", "config.json")
    const dataDir = join(dir, "data")
    makeStubBin(stubBin, "git", "echo 'git version 2.47.0'")
    process.env.BEERENGINEER_CONFIG_PATH = configPath
    process.env.BEERENGINEER_DATA_DIR = dataDir
    process.env.PATH = `${stubBin}:${previousPath ?? ""}`

    const result = spawnSync(process.execPath, [binPath, "doctor", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: process.env,
    })
    assert.equal(result.status, 1)

    const report = JSON.parse(result.stdout) as {
      overall: string
      groups: Array<{ id: string; checks: Array<{ id: string; status: string }> }>
    }
    assert.equal(report.overall, "blocked")
    const core = report.groups.find(group => group.id === "core")
    assert.ok(core)
    assert.equal(core.checks.find(check => check.id === "core.config")?.status, "uninitialized")
  } finally {
    if (previousConfigPath === undefined) delete process.env.BEERENGINEER_CONFIG_PATH
    else process.env.BEERENGINEER_CONFIG_PATH = previousConfigPath
    if (previousDataDir === undefined) delete process.env.BEERENGINEER_DATA_DIR
    else process.env.BEERENGINEER_DATA_DIR = previousDataDir
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setup --no-interactive provisions config and database", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const stubBin = join(dir, "bin")
  const configPath = join(dir, "config", "config.json")
  const dataDir = join(dir, "data")

  try {
    makeStubBin(stubBin, "git", "echo 'git version 2.47.0'")
    makeStubBin(stubBin, "claude", "echo 'claude 1.2.3'")
    const result = spawnSync(
      process.execPath,
      [binPath, "setup", "--no-interactive"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${stubBin}:${process.env.PATH ?? ""}`,
          BEERENGINEER_CONFIG_PATH: configPath,
          BEERENGINEER_DATA_DIR: dataDir,
          ANTHROPIC_API_KEY: "test-key",
        },
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { dataDir: string }
    assert.equal(config.dataDir, dataDir)
    const db = initDatabase(resolveConfiguredDbPath(config))
    db.close()
    assert.match(result.stdout ?? "", /App setup initialized config, data dir, and database\./)
    assert.match(result.stdout ?? "", /Next: beerengineer workspace add <path>/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setup accepts Claude subscription auth without ANTHROPIC_API_KEY", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const stubBin = join(dir, "bin")
  const configPath = join(dir, "config", "config.json")
  const dataDir = join(dir, "data")

  try {
    makeStubBin(stubBin, "git", "echo 'git version 2.47.0'")
    makeStubBin(stubBin, "claude", `
if [ "$#" -ge 1 ] && [ "$1" = "--version" ]; then
  echo 'claude 1.2.3'
elif [ "$#" -ge 2 ] && [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}'
else
  exit 1
fi`)
    const result = spawnSync(
      process.execPath,
      [binPath, "setup", "--no-interactive"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${stubBin}:${process.env.PATH ?? ""}`,
          BEERENGINEER_CONFIG_PATH: configPath,
          BEERENGINEER_DATA_DIR: dataDir,
        },
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /App setup initialized config, data dir, and database\./)
    assert.doesNotMatch(result.stdout ?? "", /ANTHROPIC_API_KEY is not set/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("workspace add/register/open/remove work end-to-end through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const stubBin = join(dir, "bin")
  const configPath = join(dir, "config", "config.json")
  const dataDir = join(dir, "data")
  const workspacePath = join(dir, "projects", "demo-app")
  const dbPath = join(dir, "workspaces.sqlite")

  try {
    mkdirSync(join(dir, "projects"), { recursive: true })
    mkdirSync(join(dir, "config"), { recursive: true })
    makeStubBin(stubBin, "claude", "echo 'claude 1.2.3'")
    makeStubBin(stubBin, "codex", "echo 'codex 1.2.3'")
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      dataDir,
      allowedRoots: [join(dir, "projects")],
      enginePort: 4100,
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyRef: "ANTHROPIC_API_KEY",
        defaultHarnessProfile: { mode: "claude-first" },
        defaultSonarOrganization: "acme",
      },
      vcs: { github: { enabled: false } },
      browser: { enabled: false },
    }, null, 2))

    const env = {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
      BEERENGINEER_CONFIG_PATH: configPath,
      BEERENGINEER_DATA_DIR: dataDir,
      BEERENGINEER_UI_DB_PATH: dbPath,
      ANTHROPIC_API_KEY: "anthropic-test",
      OPENAI_API_KEY: "openai-test",
    }

    const add = spawnSync(
      process.execPath,
      [binPath, "workspace", "add", "--path", workspacePath, "--profile", "fast", "--sonar", "--no-git", "--no-interactive"],
      { cwd: engineRoot, encoding: "utf8", env },
    )
    assert.equal(add.status, 0, `${add.stdout ?? ""}\n${add.stderr ?? ""}`)
    assert.match(add.stdout ?? "", /Registered as "demo-app" \(key: demo-app\)\./)
    assert.match(add.stdout ?? "", /SonarCloud config generation skipped until a GitHub origin remote is configured/)
    assert.match(add.stdout ?? "", /SONAR_TOKEN is not configured yet; CI and local scans will remain incomplete/)
    assert.match(add.stdout ?? "", /Optional: install the CLI with npm i -g @coderabbit\/cli/)
    assert.match(add.stdout ?? "", /BeerEngineer will skip CodeRabbit review for the workspace/)
    assert.ok(existsSync(join(workspacePath, ".beerengineer", "workspace.json")))
    assert.equal(existsSync(join(workspacePath, "sonar-project.properties")), false)

    const open = spawnSync(process.execPath, [binPath, "workspace", "open", "demo-app"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    assert.equal(open.status, 0, `${open.stdout ?? ""}\n${open.stderr ?? ""}`)
    assert.equal((open.stdout ?? "").trim(), workspacePath)

    const get = spawnSync(process.execPath, [binPath, "workspace", "get", "demo-app", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    assert.equal(get.status, 0, `${get.stdout ?? ""}\n${get.stderr ?? ""}`)
    const workspace = JSON.parse(get.stdout) as { key: string; sonarEnabled: boolean; harnessProfile: { mode: string } }
    assert.equal(workspace.key, "demo-app")
    assert.equal(workspace.sonarEnabled, false)
    assert.equal(workspace.harnessProfile.mode, "fast")

    const remove = spawnSync(process.execPath, [binPath, "workspace", "remove", "demo-app"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    assert.equal(remove.status, 0, `${remove.stdout ?? ""}\n${remove.stderr ?? ""}`)
    assert.match(remove.stdout ?? "", /Removed workspace demo-app/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("workspace backfill writes missing workspace.json files for existing rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-backfill-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "backfill.sqlite")
  const rootPath = join(dir, "project")

  try {
    mkdirSync(rootPath, { recursive: true })
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    repos.upsertWorkspace({
      key: "legacy",
      name: "Legacy",
      rootPath,
      harnessProfileJson: JSON.stringify({ mode: "fast" }),
      sonarEnabled: true,
    })
    db.close()

    const result = spawnSync(process.execPath, [binPath, "workspace", "backfill", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
    })

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    const body = JSON.parse(result.stdout) as { written: string[] }
    assert.deepEqual(body.written, ["legacy"])
    const config = JSON.parse(readFileSync(join(rootPath, ".beerengineer", "workspace.json"), "utf8")) as { key: string; harnessProfile: { mode: string } }
    assert.equal(config.key, "legacy")
    assert.equal(config.harnessProfile.mode, "fast")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("resolveUiLaunchUrl uses the dedicated UI operator port", () => {
  assert.equal(resolveUiLaunchUrl(), "http://127.0.0.1:3100")
})

test("resolveItemReference rejects ambiguous item codes across workspaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  try {
    const db = initDatabase(join(dir, "items.sqlite"))
    const repos = new Repos(db)
    const w1 = repos.upsertWorkspace({ key: "w1", name: "W1" })
    const w2 = repos.upsertWorkspace({ key: "w2", name: "W2" })
    repos.createItem({ workspaceId: w1.id, code: "ITEM-0001", title: "A", description: "" })
    repos.createItem({ workspaceId: w2.id, code: "ITEM-0001", title: "B", description: "" })

    const resolved = resolveItemReference(repos, "ITEM-0001")
    assert.equal(resolved.kind, "ambiguous")
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer bin shim runs the TypeScript entrypoint", () => {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const result = spawnSync(process.execPath, [binPath, "--help"], {
    cwd: engineRoot,
    encoding: "utf8",
  })

  assert.equal(result.status, 0)
  assert.match(`${result.stdout ?? ""}${result.stderr ?? ""}`, /BeerEngineer2 CLI/)
})

test("help output explains that user prompts are limited to intake and blockers", async () => {
  const stdoutChunks: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    stdoutChunks.push(args.join(" "))
  }

  try {
    await main(["--help"])
  } finally {
    console.log = originalLog
  }

  const output = stdoutChunks.join("\n")
  assert.match(output, /User prompts are limited to intake and blocked-run recovery\./)
  assert.match(output, /architecture/)
  assert.match(output, /documentation run without user chat unless a blocker stops the run\./)
})

// Integration smoke test: drives the real workflow through stdio with scripted
// answers. Kept in the main suite because it's the regression catch for the
// lookupTransition wiring between index.ts and itemActions.ts — skipping it
// previously let a broken start_brainstorm CLI ship unnoticed.
test("beerengineer item action start_brainstorm runs to completion through the terminal CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
        input: [
          "answer 1",
          "answer 2",
          "answer 3",
          "clarify 1",
          "clarify 2",
          ...Array.from({ length: 16 }, () => "accept"),
          ...Array.from({ length: 16 }, () => "merge"),
        ].join("\n") + "\n",
        timeout: 15000,
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /start_brainstorm applied/)
    assert.match(result.stdout ?? "", /run-id:/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns()
    assert.equal(runs.length, 1)
    assert.equal(runs[0].owner, "cli")
    assert.equal(runs[0].status, "completed")
    verifyDb.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer item action start_implementation resumes from brainstorm artifacts as a cli-owned run", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-impl-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  let workspaceIdForCleanup: string | null = null

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    const item = repos.createItem({
      workspaceId: ws.id,
      code: "ITEM-0001",
      title: "CLI Implementation",
      description: "resume from brainstorm",
    })
    repos.setItemColumn(item.id, "requirements", "draft")
    const seedRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    db.close()

    const workspaceId = `cli-implementation-${item.id.toLowerCase()}`
    workspaceIdForCleanup = workspaceId
    const brainstormDir = layout.stageArtifactsDir({ workspaceId, runId: seedRun.id }, "brainstorm")
    rmSync(layout.workspaceDir(workspaceId), { recursive: true, force: true })
    mkdirSync(brainstormDir, { recursive: true })
    writeFileSync(
      join(brainstormDir, "projects.json"),
      JSON.stringify(
        [
          {
            id: item.id,
            name: "Browser greeting page",
            description: "Add a browser-rendered greeting alongside the CLI.",
            concept: {
              summary: "Browser greeting page for the hello-world-cli repo.",
              problem: "The repo only exposes Hello, World! via CLI today.",
              users: ["Developers who want a browser UI in addition to the CLI"],
              constraints: ["React 18", "TypeScript strict", "Vitest", "Do not break bin/hello.js"],
            },
          },
        ],
        null,
        2,
      ),
    )

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_implementation"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
        input: [
          "Focus on a single static greeting page.",
          "Keep CLI and browser entry points separate.",
          ...Array.from({ length: 16 }, () => "accept"),
          ...Array.from({ length: 16 }, () => "merge"),
        ].join("\n") + "\n",
        timeout: 20000,
      },
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /start_implementation applied/)
    assert.match(result.stdout ?? "", /run-id:/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns().filter(run => run.item_id === item.id)
    const latest = runs.sort((a, b) => b.created_at - a.created_at)[0]
    assert.equal(latest?.owner, "cli")
    assert.equal(latest?.status, "completed")
    verifyDb.close()
  } finally {
    if (workspaceIdForCleanup) rmSync(layout.workspaceDir(workspaceIdForCleanup), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer item action resume_run exits 75 without remediation summary in non-interactive mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")

  try {
    const dbPath = join(dir, "resume.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Blocked CLI Workflow", description: "smoke" })
    repos.setItemColumn(item.id, "implementation", "failed")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.setRunRecovery(run.id, { status: "blocked", scope: "run", scopeRef: null, summary: "fix needed" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "resume_run"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
      }
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Missing --remediation-summary/)
    assert.match(result.stderr ?? "", /Run .* is blocked\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer item action start_brainstorm fails early on dirty workspace repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-dirty-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "workspace")

  try {
    mkdirSync(repoRoot, { recursive: true })
    assert.equal(spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    writeFileSync(join(repoRoot, "README.md"), "seed\n")
    assert.equal(spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    writeFileSync(join(repoRoot, "dirty.txt"), "uncommitted\n")

    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
      }
    )

    assert.equal(result.status, 73, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Git preflight failed: workspace repo is dirty\./)
    assert.match(result.stderr ?? "", /Strategy violation: uncommitted work is sitting on main\/master\./)
    assert.match(result.stderr ?? "", /main\/master to stay clean; item work must happen on item\/\* branches\./)
    assert.match(result.stderr ?? "", /git status/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    assert.equal(verifyRepos.listRuns().length, 0)
    verifyDb.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

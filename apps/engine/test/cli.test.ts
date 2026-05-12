import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { resolveLegacyDbCleanupLogPath } from "../src/db/legacyDbReconciler.js"
import { Repos } from "../src/db/repositories.js"
import { main, parseArgs, resolveItemReference, resolveUiLaunchUrl, resolveUiWorkspacePath } from "../src/index.js"
import { printHelp } from "../src/cli/parse.js"
import { assignPort } from "../src/core/portAllocator.js"
import { CONFIG_SCHEMA_VERSION, resolveConfiguredDbPath } from "../src/setup/config.js"
import { layout } from "../src/core/workspaceLayout.js"
import { writeWorkspaceConfig } from "../src/core/workspaces.js"
import { buildWorkspaceConfigFile } from "../src/core/workspaces/configFile.js"
import { removeTempDir } from "./helpers/fs.js"

function makeStubBin(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
}

const TEST_API_TOKEN = "test-token"

async function findFreePort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const probe = createNetServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("failed to allocate an ephemeral test port")))
        return
      }
      const { port } = address
      probe.close(error => {
        if (error) reject(error)
        else resolvePromise(port)
      })
    })
  })
}

async function waitForHealth(base: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

async function startEngineServer(env: NodeJS.ProcessEnv): Promise<{ proc: ChildProcess; base: string; port: number }> {
  const port = await findFreePort()
  const host = "127.0.0.1"
  const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      HOST: host,
      PORT: String(port),
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout.on("data", () => {})
  proc.stderr.on("data", () => {})
  return { proc, base: `http://${host}:${port}`, port }
}

function stopEngineServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolvePromise => {
    if (proc.exitCode !== null) return resolvePromise()
    proc.once("exit", () => resolvePromise())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

test("parseArgs recognizes help, doctor, start ui, workflow, item action, and unknown commands", () => {
  assert.deepEqual(parseArgs([]), { kind: "workflow", json: false, workspaceKey: undefined, verbose: false })
  assert.deepEqual(parseArgs(["--json"]), { kind: "workflow", json: true, workspaceKey: undefined, verbose: false })
  assert.deepEqual(parseArgs(["run", "--json"]), { kind: "workflow", json: true, workspaceKey: undefined, verbose: false })
  assert.deepEqual(parseArgs(["--workspace", "demo"]), { kind: "workflow", json: false, workspaceKey: "demo", verbose: false })
  assert.deepEqual(parseArgs(["run", "--json", "--verbose"]), { kind: "workflow", json: true, workspaceKey: undefined, verbose: true })
  assert.deepEqual(parseArgs(["status", "--workspace", "demo", "--json"]), { kind: "status", workspaceKey: "demo", json: true, all: false })
  assert.deepEqual(parseArgs(["status", "--all", "--json"]), { kind: "status", workspaceKey: undefined, json: true, all: true })
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" })
  assert.deepEqual(parseArgs(["-h"]), { kind: "help" })
  assert.deepEqual(parseArgs(["--doctor"]), { kind: "doctor", json: false, group: undefined })
  assert.deepEqual(parseArgs(["doctor", "--json", "--group", "core"]), { kind: "doctor", json: true, group: "core" })
  assert.deepEqual(parseArgs(["setup", "--no-interactive"]), { kind: "setup", group: undefined, noInteractive: true })
  assert.deepEqual(parseArgs(["update", "--check", "--json"]), {
    kind: "update",
    check: true,
    json: true,
    dryRun: false,
    rollback: false,
    version: undefined,
    allowLegacyDbShadow: false,
  })
  assert.deepEqual(parseArgs(["update", "--json"]), {
    kind: "update",
    check: false,
    json: true,
    dryRun: false,
    rollback: false,
    version: undefined,
    allowLegacyDbShadow: false,
  })
  assert.deepEqual(parseArgs(["update", "--rollback", "--json"]), {
    kind: "update",
    check: false,
    json: true,
    dryRun: false,
    rollback: true,
    version: undefined,
    allowLegacyDbShadow: false,
  })
  assert.deepEqual(parseArgs(["update", "--dry-run", "--version", "v9.9.9", "--allow-legacy-db-shadow"]), {
    kind: "update",
    check: false,
    json: false,
    dryRun: true,
    rollback: false,
    version: "v9.9.9",
    allowLegacyDbShadow: true,
  })
  assert.deepEqual(parseArgs(["start"]), { kind: "start-engine" })
  assert.deepEqual(parseArgs(["notifications", "test", "telegram"]), { kind: "notifications-test", channel: "telegram" })
  assert.deepEqual(parseArgs(["workspace", "preview", "/tmp/demo", "--json"]), { kind: "workspace-preview", path: "/tmp/demo", json: true })
  assert.deepEqual(parseArgs(["run", "skip-current-stage", "run-123"]), { kind: "run-skip-current-stage", runId: "run-123" })
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
  assert.deepEqual(parseArgs(["workspace", "items", "demo", "--json"]), { kind: "workspace-items", key: "demo", json: true })
  assert.deepEqual(parseArgs(["projects", "--json"]), { kind: "workspace-list", json: true })
  assert.deepEqual(parseArgs(["project", "list", "--json"]), { kind: "workspace-list", json: true })
  assert.deepEqual(parseArgs(["project", "get", "demo", "--json"]), { kind: "workspace-get", key: "demo", json: true })
  assert.deepEqual(parseArgs(["project", "items", "demo", "--json"]), { kind: "workspace-items", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "use", "demo"]), { kind: "workspace-use", key: "demo" })
  assert.deepEqual(parseArgs(["workspace", "remove", "demo", "--purge"]), { kind: "workspace-remove", key: "demo", json: false, purge: true, yes: false, noInteractive: false })
  assert.deepEqual(parseArgs(["workspace", "remove", "demo", "--purge", "--yes"]), { kind: "workspace-remove", key: "demo", json: false, purge: true, yes: true, noInteractive: false })
  assert.deepEqual(parseArgs(["workspace", "open", "demo"]), { kind: "workspace-open", key: "demo" })
  assert.deepEqual(parseArgs(["workspace", "backfill", "--json"]), { kind: "workspace-backfill", json: true })
  assert.deepEqual(parseArgs(["workspace", "sonar", "enable", "demo", "--json"]), { kind: "workspace-sonar-enable", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "sonar", "audit", "demo", "--json"]), { kind: "workspace-sonar-audit", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "sonar", "repair", "demo", "--apply", "--json"]), { kind: "workspace-sonar-repair", key: "demo", json: true, apply: true })
  assert.deepEqual(parseArgs(["chat", "list", "--workspace", "demo", "--json"]), { kind: "chat-list", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["chat", "list", "--all", "--json"]), { kind: "chat-list", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["chat", "list", "--all", "--compact"]), { kind: "chat-list", workspaceKey: undefined, json: false, all: true, compact: true })
  assert.deepEqual(parseArgs(["chat", "send", "run-1", "Heads", "up", "--json"]), { kind: "chat-send", runId: "run-1", text: "Heads up", json: true })
  assert.deepEqual(parseArgs(["chat", "answer", "--prompt", "p-1", "--text", "Ship it"]), { kind: "chat-answer", promptId: "p-1", runId: undefined, answer: "Ship it", multiline: false, editor: false, json: false })
  assert.deepEqual(parseArgs(["chat", "answer", "--run", "r-1", "--multiline"]), { kind: "chat-answer", promptId: undefined, runId: "r-1", answer: undefined, multiline: true, editor: false, json: false })
  assert.deepEqual(parseArgs(["chat", "answer", "--run", "r-1", "--editor"]), { kind: "chat-answer", promptId: undefined, runId: "r-1", answer: undefined, multiline: false, editor: true, json: false })
  assert.deepEqual(parseArgs(["chat", "answer", "r-1", "Ship", "it", "--json"]), { kind: "chat-answer", promptId: undefined, runId: "r-1", answer: "Ship it", multiline: false, editor: false, json: true })
  assert.deepEqual(parseArgs(["items", "--workspace", "demo", "--json"]), { kind: "items", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["items", "--all", "--json"]), { kind: "items", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["chats", "--workspace", "demo", "--json"]), { kind: "chats", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["chats", "--all", "--json"]), { kind: "chats", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["item", "get", "ITEM-0001", "--workspace", "demo", "--json"]), { kind: "item-get", itemRef: "ITEM-0001", workspaceKey: "demo", json: true })
  assert.deepEqual(parseArgs(["item", "open", "ITEM-0001", "--workspace", "demo"]), { kind: "item-open", itemRef: "ITEM-0001", workspaceKey: "demo" })
  assert.deepEqual(parseArgs(["item", "preview", "ITEM-0001", "--workspace", "demo", "--start", "--open", "--json"]), { kind: "item-preview", itemRef: "ITEM-0001", workspaceKey: "demo", start: true, stop: false, open: true, json: true })
  assert.deepEqual(parseArgs(["item", "preview", "ITEM-0001", "--workspace", "demo", "--stop", "--json"]), { kind: "item-preview", itemRef: "ITEM-0001", workspaceKey: "demo", start: false, stop: true, open: false, json: true })
  assert.deepEqual(parseArgs(["item", "wireframes", "ITEM-0001", "--workspace", "demo", "--open", "--json"]), { kind: "item-wireframes", itemRef: "ITEM-0001", workspaceKey: "demo", open: true, json: true })
  assert.deepEqual(parseArgs(["item", "design", "ITEM-0001", "--workspace", "demo"]), { kind: "item-design", itemRef: "ITEM-0001", workspaceKey: "demo", open: false, json: false })
  assert.deepEqual(parseArgs(["item", "import-prepared", "ITEM-0001", "--from", "/tmp/prepared", "--json"]), { kind: "item-import-prepared", itemRef: "ITEM-0001", sourceDir: "/tmp/prepared", workspaceKey: undefined, json: true })
  assert.deepEqual(parseArgs(["run", "list", "--workspace", "demo", "--json"]), { kind: "run-list", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["run", "list", "--all", "--json"]), { kind: "run-list", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["run", "list", "--all", "--compact"]), { kind: "run-list", workspaceKey: undefined, json: false, all: true, compact: true })
  assert.deepEqual(parseArgs(["run", "get", "run-123", "--json"]), { kind: "run-get", runId: "run-123", json: true })
  assert.deepEqual(parseArgs(["run", "open", "run-123"]), { kind: "run-open", runId: "run-123" })
  assert.deepEqual(parseArgs(["run", "tail", "run-123", "--since", "msg-1", "--level", "L0", "--json"]), { kind: "run-tail", runId: "run-123", level: 0, since: "msg-1", json: true })
  assert.deepEqual(parseArgs(["runs", "messages", "run-123", "--limit", "50"]), { kind: "run-messages", runId: "run-123", level: 2, since: undefined, limit: 50, json: false })
  assert.deepEqual(parseArgs(["run", "watch", "run-123", "--level", "L2"]), { kind: "run-watch", runId: "run-123", level: 2, since: undefined, json: false })
  assert.deepEqual(parseArgs(["start", "ui"]), { kind: "start-ui" })
  assert.deepEqual(parseArgs(["runs", "--workspace", "demo", "--json"]), { kind: "runs", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["runs", "--all", "--json"]), { kind: "runs", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["chats", "--all", "--compact"]), { kind: "chats", workspaceKey: undefined, json: false, all: true, compact: true })
  assert.deepEqual(parseArgs(["item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"]), {
    kind: "item-action",
    itemRef: "ITEM-0001",
    action: "start_brainstorm"
  })
  assert.deepEqual(parseArgs(["item", "action"]), { kind: "unknown", token: "item action" })
  assert.deepEqual(parseArgs(["wat"]), { kind: "unknown", token: "wat" })
})

test("PROJ-3-PRD-3 AC-4 generic workspace capability commands are not required", () => {
  assert.deepEqual(parseArgs(["workspace", "sonar", "enable", "demo", "--json"]), { kind: "workspace-sonar-enable", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "capability", "sonar", "enable", "demo"]), { kind: "unknown", token: "workspace capability sonar enable demo" })
})

test("PROJ-3-PRD-5 AC-3 help text describes workspace capability command groups", () => {
  const lines: string[] = []
  const original = console.log
  console.log = value => lines.push(String(value))
  try {
    printHelp()
  } finally {
    console.log = original
  }
  assert.match(lines.join("\n"), /workspace git status/)
  assert.match(lines.join("\n"), /workspace coderabbit status <key> \[--json\]/)
  assert.match(lines.join("\n"), /workspace capability readiness/)
})

test("REQ-2 TC-REQ-2-05 public CLI skip-current-stage preserves the canonical recovery outcome", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-skip-stage-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "workflow.sqlite")
  const configPath = join(dir, "config.json")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  let dbClosed = false

  try {
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      dataDir: dir,
      allowedRoots: ["/tmp"],
      enginePort: 4100,
      publicBaseUrl: "http://127.0.0.1:3100",
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyRef: "ANTHROPIC_API_KEY",
        defaultHarnessProfile: { mode: "claude-first" },
      },
      vcs: { github: { enabled: false } },
      browser: { enabled: false },
    }), "utf8")

    db.close()
    dbClosed = true

    const server = await startEngineServer({ BEERENGINEER_UI_DB_PATH: dbPath })
    try {
      await waitForHealth(server.base)
      const seedDb = initDatabase(dbPath)
      const seedRepos = new Repos(seedDb)
      const workspace = seedRepos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
      const item = seedRepos.createItem({ workspaceId: workspace.id, code: "ITEM-0700", title: "Skip current stage", description: "skip" })
      const run = seedRepos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api", status: "running" })
      seedRepos.updateRun(run.id, {
        status: "running",
        current_stage: "execution",
        recovery_status: null,
        recovery_scope: null,
        recovery_scope_ref: null,
        recovery_summary: null,
        recovery_payload_json: null,
      })
      seedRepos.createStageRun({ runId: run.id, stageKey: "execution" })
      seedDb.close()

      writeFileSync(configPath, JSON.stringify({
        schemaVersion: 1,
        dataDir: dir,
        allowedRoots: ["/tmp"],
        enginePort: server.port,
        publicBaseUrl: "http://127.0.0.1:3100",
        llm: {
          provider: "anthropic",
          model: "claude-opus-4-7",
          apiKeyRef: "ANTHROPIC_API_KEY",
          defaultHarnessProfile: { mode: "claude-first" },
        },
        vcs: { github: { enabled: false } },
        browser: { enabled: false },
      }), "utf8")

      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
        const child = spawn(process.execPath, [binPath, "run", "skip-current-stage", run.id], {
          cwd: engineRoot,
          env: {
            ...process.env,
            BEERENGINEER_CONFIG_PATH: configPath,
            BEERENGINEER_UI_DB_PATH: dbPath,
            BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
            BEERENGINEER_ENGINE_PORT: String(server.port),
          },
          stdio: ["ignore", "pipe", "pipe"],
        })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", chunk => { stdout += chunk.toString("utf8") })
        child.stderr.on("data", chunk => { stderr += chunk.toString("utf8") })
        child.on("error", reject)
        child.on("exit", code => resolvePromise({ code, stdout, stderr }))
      })

      assert.equal(result.code, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
      assert.match(result.stdout, /current stage skipped/)

      const recoveryResponse = await fetch(`${server.base}/runs/${run.id}/recovery`)
      const recoveryBody = await recoveryResponse.json() as {
        recovery: { status: string; scope: string; scopeRef: string; availableActions: string[] }
      }
      assert.equal(recoveryBody.recovery.status, "blocked")
      assert.equal(recoveryBody.recovery.scope, "stage")
      assert.equal(recoveryBody.recovery.scopeRef, "execution")
      assert.deepEqual(recoveryBody.recovery.availableActions, [])

      const treeResponse = await fetch(`${server.base}/runs/${run.id}/tree`)
      const treeBody = await treeResponse.json() as {
        run: { current_stage: string | null; status: string; recovery_status: string | null }
        stageRuns: Array<{ stage_key: string; status: string }>
      }
      assert.equal(treeBody.run.current_stage, "execution")
      assert.equal(treeBody.run.status, "blocked")
      assert.equal(treeBody.run.recovery_status, "blocked")
      assert.deepEqual(treeBody.stageRuns.map(stageRun => [stageRun.stage_key, stageRun.status]), [["execution", "skipped"]])
    } finally {
      await stopEngineServer(server.proc)
    }
  } finally {
    if (!dbClosed) db.close()
    removeTempDir(dir)
  }
})

test("doctor --json reports blocked status when the app config is uninitialized", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousConfigPath = process.env.BEERENGINEER_CONFIG_PATH
  const previousDataDir = process.env.BEERENGINEER_DATA_DIR
  const previousPath = process.env.PATH
  const previousSandboxBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
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
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

    const result = spawnSync(process.execPath, [binPath, "doctor", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: process.env,
    })
    assert.equal(result.status, 1)

    const report = JSON.parse(result.stdout) as {
      overall: string
      codexSandbox?: { state: string; reason: string }
      groups: Array<{ id: string; checks: Array<{ id: string; status: string }> }>
    }
    assert.equal(report.overall, "blocked")
    assert.equal(report.codexSandbox?.state, "unverified_bypassing")
    assert.equal(report.codexSandbox?.reason, "unverified")
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
    if (previousSandboxBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousSandboxBypass
    removeTempDir(dir)
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
    removeTempDir(dir)
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
    removeTempDir(dir)
  }
})

test("notifications test telegram sends a smoke message through the configured bot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const configPath = join(dir, "config", "config.json")
  const dataDir = join(dir, "data")
  const requests: Array<{ url: string; body: string }> = []

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(chunk as Buffer))
    req.on("end", () => {
      requests.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") })
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }))
    })
  })

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0

  try {
    mkdirSync(join(dir, "config"), { recursive: true })
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      dataDir,
      allowedRoots: [join(dir, "projects")],
      enginePort: 4100,
      publicBaseUrl: "http://100.64.0.7:3100",
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyRef: "ANTHROPIC_API_KEY",
        defaultHarnessProfile: { mode: "claude-first" },
      },
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "123456",
        },
      },
      vcs: { github: { enabled: false } },
      browser: { enabled: false },
    }, null, 2))

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [binPath, "notifications", "test", "telegram"],
        {
          cwd: engineRoot,
          env: {
            ...process.env,
            BEERENGINEER_CONFIG_PATH: configPath,
            BEERENGINEER_DATA_DIR: dataDir,
            BEERENGINEER_TELEGRAM_API_BASE_URL: `http://127.0.0.1:${port}`,
            TELEGRAM_BOT_TOKEN: "secret-token",
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", chunk => { stdout += chunk.toString("utf8") })
      child.stderr.on("data", chunk => { stderr += chunk.toString("utf8") })
      child.on("error", reject)
      child.on("exit", code => resolve({ code, stdout, stderr }))
    })

    assert.equal(result.code, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /Telegram test notification sent\./)
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/botsecret-token\/sendMessage$/)
    assert.match(requests[0].body, /beerengineer_ test notification/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    removeTempDir(dir)
  }
})

test("item open and run open print UI URLs based on publicBaseUrl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "beerengineer.sqlite")
  const configPath = join(dir, "config.json")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      dataDir: dir,
      allowedRoots: ["/tmp"],
      enginePort: 4100,
      publicBaseUrl: "http://100.80.38.41:3100",
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyRef: "ANTHROPIC_API_KEY",
        defaultHarnessProfile: { mode: "claude-first" },
      },
      vcs: { github: { enabled: false } },
      browser: { enabled: false },
    }), "utf8")

    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0600", title: "Open item", description: "open" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })

    const env = {
      ...process.env,
      BEERENGINEER_UI_DB_PATH: dbPath,
      BEERENGINEER_CONFIG_PATH: configPath,
      BEERENGINEER_DISABLE_BROWSER_OPEN: "1",
    }
    delete env.BEERENGINEER_PUBLIC_BASE_URL
    const itemOpen = spawnSync(process.execPath, [binPath, "item", "open", "ITEM-0600", "--workspace", "demo"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    const runOpen = spawnSync(process.execPath, [binPath, "run", "open", run.id], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    assert.equal(itemOpen.status, 0, `${itemOpen.stdout ?? ""}\n${itemOpen.stderr ?? ""}`)
    assert.equal(runOpen.status, 0, `${runOpen.stdout ?? ""}\n${runOpen.stderr ?? ""}`)

    const stdout = `${itemOpen.stdout ?? ""}${runOpen.stdout ?? ""}`
    assert.match(stdout, /http:\/\/100\.80\.38\.41:3100\/\?workspace=demo&item=ITEM-0600/)
    assert.match(stdout, new RegExp(`http://100\\.80\\.38\\.41:3100/runs/${run.id}`))
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("item wireframes and item design print artifact info and support --json", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-artifacts-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")

  try {
    const dbPath = join(dir, "artifacts.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const repoRoot = join(dir, "repo")
    mkdirSync(repoRoot, { recursive: true })
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Artifact Item", description: "artifacts" })
    const workspaceId = `artifact-item-${item.id.toLowerCase()}`
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId: workspaceId,
    })
    repos.updateRun(run.id, { status: "completed" })
    db.close()

    const wireframesDir = layout.stageArtifactsDir({ workspaceId, workspaceRoot: repoRoot, runId: run.id }, "visual-companion")
    const designDir = layout.stageArtifactsDir({ workspaceId, workspaceRoot: repoRoot, runId: run.id }, "frontend-design")
    mkdirSync(wireframesDir, { recursive: true })
    mkdirSync(designDir, { recursive: true })
    writeFileSync(join(wireframesDir, "wireframes.json"), JSON.stringify({
      inputMode: "none",
      screens: [{ id: "home", name: "Home", purpose: "Overview", projectIds: ["P01"], layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] }, elements: [] }],
      navigation: { entryPoints: [{ screenId: "home", projectId: "P01" }], flows: [] },
    }, null, 2))
    writeFileSync(join(wireframesDir, "screen-map.html"), "<html>map</html>")
    writeFileSync(join(wireframesDir, "home.html"), "<html>home</html>")
    writeFileSync(join(designDir, "design.json"), JSON.stringify({
      inputMode: "none",
      tokens: { light: { primary: "#000", secondary: "#111", accent: "#222", background: "#fff", surface: "#f7f7f7", textPrimary: "#111", textMuted: "#666", success: "#0a0", warning: "#aa0", error: "#a00", info: "#00a" } },
      typography: { display: { family: "Fraunces", weight: "700", usage: "Display" }, body: { family: "Manrope", weight: "500", usage: "Body" }, scale: { md: "1rem" } },
      spacing: { baseUnit: "8px", sectionPadding: "32px", cardPadding: "16px", contentMaxWidth: "1200px" },
      borders: { buttons: "999px", cards: "16px", badges: "999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
      tone: "Clean and direct.",
      antiPatterns: ["generic defaults"],
    }, null, 2))
    writeFileSync(join(designDir, "design-preview.html"), "<html>preview</html>")

    const wireframes = spawnSync(process.execPath, [binPath, "item", "wireframes", "ITEM-0001", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_DISABLE_BROWSER_OPEN: "1" },
    })
    assert.equal(wireframes.status, 0, wireframes.stderr)
    assert.equal((JSON.parse(wireframes.stdout) as { screenCount: number }).screenCount, 1)

    const design = spawnSync(process.execPath, [binPath, "item", "design", "ITEM-0001"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_DISABLE_BROWSER_OPEN: "1" },
    })
    assert.equal(design.status, 0, design.stderr)
    assert.match(design.stdout, /design-preview:/)
  } finally {
    removeTempDir(dir)
  }
})

test("item preview prints and starts and stops the item worktree preview", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-preview-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const previousDbPath = process.env.BEERENGINEER_UI_DB_PATH

  try {
    const dbPath = join(dir, "preview.sqlite")
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const repoRoot = join(dir, "repo")
    mkdirSync(repoRoot, { recursive: true })
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Preview Item", description: "preview" })
    const workspaceId = `preview-item-${item.id.toLowerCase()}`
    repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId: workspaceId,
    })
    db.close()

    const itemSlug = "preview-item"
    const worktreePath = layout.itemWorktreeDir({ workspaceId, workspaceRoot: repoRoot, itemSlug })
    mkdirSync(join(worktreePath, ".beerengineer"), { recursive: true })
    const markerPath = join(worktreePath, "preview-started.txt")
    writeFileSync(
      join(worktreePath, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "default",
        name: "Default Workspace",
        harnessProfile: { mode: "fast" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "safe-workspace-write",
        },
        preview: {
          command: `${process.execPath} -e "const fs=require('node:fs');const http=require('node:http');const port=Number(process.env.PORT);http.createServer((_,res)=>res.end('ok')).listen(port, process.env.BEERENGINEER_PREVIEW_HOST, () => { fs.writeFileSync('preview-started.txt', String(port)); setTimeout(() => process.exit(0), 15000); });"`,
        },
        sonar: { enabled: false },
        reviewPolicy: { coderabbit: { enabled: false }, sonarcloud: { enabled: false } },
        createdAt: Date.now(),
      }, null, 2),
    )
    assignPort(worktreePath, "item/preview-item", repoRoot)

    const result = spawnSync(process.execPath, [binPath, "item", "preview", "ITEM-0001", "--start", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_DISABLE_BROWSER_OPEN: "1" },
    })
    assert.equal(result.status, 0, result.stderr)
    const body = JSON.parse(result.stdout) as { previewPort: number; status: string; launch: { command: string } }
    assert.equal(body.status, "started")
    assert.match(body.launch.command, /node -e/)

    for (let i = 0; i < 30; i++) {
      if (existsSync(markerPath)) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(readFileSync(markerPath, "utf8"), String(body.previewPort))

    const stopped = spawnSync(process.execPath, [binPath, "item", "preview", "ITEM-0001", "--stop", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_DISABLE_BROWSER_OPEN: "1" },
    })
    assert.equal(stopped.status, 0, stopped.stderr)
    const stopBody = JSON.parse(stopped.stdout) as { status: string }
    assert.equal(stopBody.status, "stopped")
  } finally {
    if (previousDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousDbPath
    removeTempDir(dir)
  }
})

test("update --check prints machine-readable release info", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  mkdirSync(dataDir, { recursive: true })
  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/latest") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: "https://example.test/demo/beerengineer/tarball/v9.9.9",
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const child = spawn(process.execPath, [binPath, "update", "--check", "--json"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")
    assert.equal(exitCode, 0, stderr)
    const parsed = JSON.parse(stdout) as {
      status: { install: { root: string } }
      check: { updateAvailable: boolean; latestRelease: { tag: string } }
    }
    assert.equal(parsed.check.latestRelease.tag, "v9.9.9")
    assert.equal(parsed.check.updateAvailable, true)
    assert.equal(parsed.status.install.root, join(dataDir, "install"))
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("workspace list silently cleans an empty legacy shadow and continues on the configured database", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-legacy-shadow-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const home = join(dir, "home")
  const dataDir = join(dir, "data")
  const configPath = join(dir, "config", "config.json")
  const config = buildCliAppConfig(dataDir, dir)
  const configuredDbPath = resolveConfiguredDbPath(config)
  const legacyDbPath = join(home, ".local", "share", "beerengineer", "beerengineer.sqlite")

  try {
    writeCliAppConfig(configPath, config)
    const configuredDb = initDatabase(configuredDbPath)
    const repos = new Repos(configuredDb)
    repos.upsertWorkspace({ key: "demo", name: "Demo workspace", rootPath: join(dir, "workspace") })
    configuredDb.close()
    initDatabase(legacyDbPath).close()
    writeFileSync(`${legacyDbPath}-wal`, "wal\n", "utf8")
    writeFileSync(`${legacyDbPath}-shm`, "shm\n", "utf8")

    const result = spawnSync(process.execPath, [binPath, "workspace", "list", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        BEERENGINEER_CONFIG_PATH: configPath,
        BEERENGINEER_UI_DB_PATH: "",
      },
    })

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.doesNotMatch(result.stderr ?? "", /legacy-db-shadow|both the configured DB|configured DB .* is missing/)
    assert.equal(existsSync(legacyDbPath), false)
    assert.equal(existsSync(`${legacyDbPath}-wal`), false)
    assert.equal(existsSync(`${legacyDbPath}-shm`), false)
    const workspaces = JSON.parse(result.stdout) as Array<{ key: string }>
    assert.deepEqual(workspaces.map(workspace => workspace.key), ["demo"])
    const [event] = readLegacyCleanupEvents(dataDir)
    assert.equal(readLegacyCleanupEvents(dataDir).length, 1)
    assert.equal(event?.event, "legacy-db-cleanup")
    assert.equal(event?.configuredDbPath, configuredDbPath)
    assert.equal(event?.legacyDbPath, legacyDbPath)
    assert.equal(event?.outcome, "cleaned")
    assert.match(event?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    removeTempDir(dir)
  }
})

test("update --dry-run proceeds past legacy shadow preflight after successful cleanup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-cleaned-shadow-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const home = join(dir, "home")
  const dataDir = join(dir, "data")
  const configPath = join(dir, "config", "config.json")
  const config = buildCliAppConfig(dataDir, dir)
  const configuredDbPath = resolveConfiguredDbPath(config)
  const legacyDbPath = join(home, ".local", "share", "beerengineer", "beerengineer.sqlite")
  const releaseRoot = join(dir, "beerengineer-release")
  const tarballPath = join(dir, "release.tar.gz")

  mkdirSync(join(releaseRoot, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "ui"), { recursive: true })
  writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({
    name: "beerengineer-release",
    version: "9.9.9",
    private: true,
    workspaces: ["apps/*"],
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "package.json"), JSON.stringify({
    name: "@beerengineer/engine",
    version: "9.9.9",
    private: true,
    type: "module",
    bin: {
      beerengineer: "./bin/beerengineer.js",
    },
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\nconsole.log('ok')\n", "utf8")
  writeFileSync(join(releaseRoot, "apps", "ui", "package.json"), JSON.stringify({
    name: "@beerengineer/ui",
    version: "9.9.9",
    private: true,
  }, null, 2))
  const tarResult = spawnSync("tar", ["-czf", tarballPath, "-C", dir, "beerengineer-release"], { encoding: "utf8" })
  assert.equal(tarResult.status, 0, tarResult.stderr)

  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/tags/v9.9.9") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: `http://127.0.0.1:${port}/demo/beerengineer/tarball/v9.9.9`,
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    if (req.url === "/demo/beerengineer/tarball/v9.9.9") {
      res.writeHead(200, { "content-type": "application/gzip" })
      res.end(readFileSync(tarballPath))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    writeCliAppConfig(configPath, config)
    initDatabase(configuredDbPath).close()
    initDatabase(legacyDbPath).close()
    writeFileSync(`${legacyDbPath}-wal`, "wal\n", "utf8")

    const child = spawn(process.execPath, [binPath, "update", "--dry-run", "--json", "--version", "v9.9.9"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        HOME: home,
        BEERENGINEER_CONFIG_PATH: configPath,
        BEERENGINEER_UI_DB_PATH: "",
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")

    assert.equal(exitCode, 0, stderr)
    assert.doesNotMatch(`${stdout}\n${stderr}`, /update_preflight_failed:legacy_db_shadow|legacy-db-shadow/)
    assert.equal(existsSync(legacyDbPath), false)
    assert.equal(existsSync(`${legacyDbPath}-wal`), false)
    const parsed = JSON.parse(stdout) as {
      dryRun: {
        status: string
        warnings: string[]
      }
    }
    assert.equal(parsed.dryRun.status, "aborted-dry-run")
    assert.deepEqual(parsed.dryRun.warnings, [])
    const [event] = readLegacyCleanupEvents(dataDir)
    assert.equal(readLegacyCleanupEvents(dataDir).length, 1)
    assert.equal(event?.event, "legacy-db-cleanup")
    assert.equal(event?.configuredDbPath, configuredDbPath)
    assert.equal(event?.legacyDbPath, legacyDbPath)
    assert.equal(event?.outcome, "cleaned")
    assert.match(event?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("update --dry-run reclaims a stale lock and reports stage results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-dry-run-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  const releaseRoot = join(dir, "beerengineer-release")
  const tarballPath = join(dir, "release.tar.gz")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "ui"), { recursive: true })
  writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({
    name: "beerengineer-release",
    version: "9.9.9",
    private: true,
    workspaces: ["apps/*"],
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "package.json"), JSON.stringify({
    name: "@beerengineer/engine",
    version: "9.9.9",
    private: true,
    type: "module",
    bin: {
      beerengineer: "./bin/beerengineer.js",
    },
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\nconsole.log('ok')\n", "utf8")
  writeFileSync(join(releaseRoot, "apps", "ui", "package.json"), JSON.stringify({
    name: "@beerengineer/ui",
    version: "9.9.9",
    private: true,
  }, null, 2))
  const tarResult = spawnSync("tar", ["-czf", tarballPath, "-C", dir, "beerengineer-release"], { encoding: "utf8" })
  assert.equal(tarResult.status, 0, tarResult.stderr)
  writeFileSync(join(dataDir, "update.lock"), JSON.stringify({
    operationId: "stale-op",
    pid: 999999,
    startedAt: Date.now() - 3 * 60 * 60 * 1000,
    host: "test-host",
  }, null, 2))
  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/tags/v9.9.9") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: `http://127.0.0.1:${port}/demo/beerengineer/tarball/v9.9.9`,
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    if (req.url === "/demo/beerengineer/tarball/v9.9.9") {
      const body = readFileSync(tarballPath)
      res.writeHead(200, { "content-type": "application/gzip" })
      res.end(body)
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const child = spawn(process.execPath, [binPath, "update", "--dry-run", "--json", "--version", "v9.9.9"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")
    assert.equal(exitCode, 0, stderr)
    const parsed = JSON.parse(stdout) as {
      dryRun: {
        status: string
        reclaimedLock: boolean
        targetRelease: { tag: string }
        stages: Array<{ name: string; status: string }>
        warnings: string[]
      }
    }
    assert.equal(parsed.dryRun.status, "aborted-dry-run")
    assert.equal(parsed.dryRun.reclaimedLock, true)
    assert.equal(parsed.dryRun.targetRelease.tag, "v9.9.9")
    assert.ok(parsed.dryRun.stages.length >= 8)
    assert.deepEqual(parsed.dryRun.stages.map(stage => stage.status), parsed.dryRun.stages.map(() => "pass"))
    assert.ok(parsed.dryRun.stages.some(stage => stage.name === "download"))
    assert.ok(parsed.dryRun.stages.some(stage => stage.name === "install"))
    assert.ok(parsed.dryRun.warnings.includes("stale-update-lock-reclaimed"))
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("update --dry-run fails closed when BEERENGINEER_UPDATE_EXPECTED_TARBALL_SHA256 does not match", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-sha-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  const releaseRoot = join(dir, "beerengineer-release")
  const tarballPath = join(dir, "release.tar.gz")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "ui"), { recursive: true })
  writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({
    name: "beerengineer-release",
    version: "9.9.9",
    private: true,
    workspaces: ["apps/*"],
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "package.json"), JSON.stringify({
    name: "@beerengineer/engine",
    version: "9.9.9",
    private: true,
    type: "module",
    bin: {
      beerengineer: "./bin/beerengineer.js",
    },
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\nconsole.log('ok')\n", "utf8")
  writeFileSync(join(releaseRoot, "apps", "ui", "package.json"), JSON.stringify({
    name: "@beerengineer/ui",
    version: "9.9.9",
    private: true,
  }, null, 2))
  const tarResult = spawnSync("tar", ["-czf", tarballPath, "-C", dir, "beerengineer-release"], { encoding: "utf8" })
  assert.equal(tarResult.status, 0, tarResult.stderr)

  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/tags/v9.9.9") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: `http://127.0.0.1:${port}/demo/beerengineer/tarball/v9.9.9`,
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    if (req.url === "/demo/beerengineer/tarball/v9.9.9") {
      res.writeHead(200, { "content-type": "application/gzip" })
      res.end(readFileSync(tarballPath))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const child = spawn(process.execPath, [binPath, "update", "--dry-run", "--json", "--version", "v9.9.9"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
        BEERENGINEER_UPDATE_EXPECTED_TARBALL_SHA256: "deadbeef",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    assert.equal(exitCode, 1)
    const parsed = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8")) as {
      dryRun?: { status: string; stages: Array<{ name: string; status: string; detail: string }> }
      error?: string
    }
    if (parsed.error) {
      assert.match(parsed.error, /update_validate_failed:tarball_sha256_mismatch:/)
    } else {
      assert.equal(parsed.dryRun?.status, "failed")
      assert.ok(parsed.dryRun?.stages.some(stage =>
        stage.status === "fail" &&
        stage.detail.includes("update_validate_failed:tarball_sha256_mismatch:")
      ))
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("update --dry-run fails closed when the tarball redirect leaves the trusted host set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-redirect-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  mkdirSync(dataDir, { recursive: true })

  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/tags/v9.9.9") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: `http://127.0.0.1:${port}/demo/beerengineer/tarball/v9.9.9`,
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    if (req.url === "/demo/beerengineer/tarball/v9.9.9") {
      res.writeHead(302, { location: "http://malicious.example.invalid/payload.tar.gz" })
      res.end()
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const child = spawn(process.execPath, [binPath, "update", "--dry-run", "--json", "--version", "v9.9.9"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    assert.equal(exitCode, 1)
    const parsed = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8")) as {
      dryRun?: { status: string; stages: Array<{ status: string; detail: string }> }
      error?: string
    }
    if (parsed.error) {
      assert.match(parsed.error, /update_download_failed:untrusted_redirect_host:malicious\.example\.invalid/)
    } else {
      assert.equal(parsed.dryRun?.status, "failed")
      assert.ok(parsed.dryRun?.stages.some(stage =>
        stage.status === "fail" &&
        stage.detail.includes("update_download_failed:untrusted_redirect_host:malicious.example.invalid")
      ))
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("update --rollback returns the reserved unsupported response in json mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-rollback-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  mkdirSync(dataDir, { recursive: true })

  try {
    const child = spawn(process.execPath, [binPath, "update", "--rollback", "--json"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")
    assert.equal(exitCode, 1, stderr)
    const parsed = JSON.parse(stdout) as { error: string; code: string }
    assert.equal(parsed.error, "post-migration-rollback-unsupported")
    assert.equal(parsed.code, "post-migration-rollback-unsupported")
  } finally {
    removeTempDir(dir)
  }
})

test("update prepares a staged apply attempt and returns machine-readable metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-update-apply-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "update.sqlite")
  const dataDir = join(dir, "data")
  const releaseRoot = join(dir, "beerengineer-release")
  const tarballPath = join(dir, "release.tar.gz")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(releaseRoot, "apps", "ui"), { recursive: true })
  writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({
    name: "beerengineer-release",
    version: "9.9.9",
    private: true,
    workspaces: ["apps/*"],
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "package.json"), JSON.stringify({
    name: "@beerengineer/engine",
    version: "9.9.9",
    private: true,
    type: "module",
    bin: {
      beerengineer: "./bin/beerengineer.js",
    },
  }, null, 2))
  writeFileSync(join(releaseRoot, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\nconsole.log('ok')\n", "utf8")
  writeFileSync(join(releaseRoot, "apps", "ui", "package.json"), JSON.stringify({
    name: "@beerengineer/ui",
    version: "9.9.9",
    private: true,
  }, null, 2))
  const tarResult = spawnSync("tar", ["-czf", tarballPath, "-C", dir, "beerengineer-release"], { encoding: "utf8" })
  assert.equal(tarResult.status, 0, tarResult.stderr)

  const server = createServer((req, res) => {
    if (req.url === "/repos/demo/beerengineer/releases/tags/v9.9.9") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        tag_name: "v9.9.9",
        tarball_url: `http://127.0.0.1:${port}/demo/beerengineer/tarball/v9.9.9`,
        html_url: "https://example.test/demo/beerengineer/releases/tag/v9.9.9",
        published_at: "2026-04-27T00:00:00.000Z",
      }))
      return
    }
    if (req.url === "/demo/beerengineer/tarball/v9.9.9") {
      const body = readFileSync(tarballPath)
      res.writeHead(200, { "content-type": "application/gzip" })
      res.end(body)
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as { port: number }).port

  try {
    const child = spawn(process.execPath, [binPath, "update", "--json", "--version", "v9.9.9"], {
      cwd: engineRoot,
      env: {
        ...process.env,
        BEERENGINEER_UI_DB_PATH: dbPath,
        BEERENGINEER_DATA_DIR: dataDir,
        BEERENGINEER_UPDATE_GITHUB_REPO: "demo/beerengineer",
        BEERENGINEER_UPDATE_GITHUB_API_BASE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    const exitCode = await new Promise<number | null>(resolve => child.once("exit", code => resolve(code)))
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")
    assert.equal(exitCode, 0, stderr)
    const parsed = JSON.parse(stdout) as {
      apply: { state: string; targetRelease: { tag: string }; stagedRoot: string; switcherPath: string }
    }
    assert.equal(parsed.apply.state, "queued")
    assert.equal(parsed.apply.targetRelease.tag, "v9.9.9")
    assert.equal(existsSync(parsed.apply.stagedRoot), true)
    assert.equal(existsSync(parsed.apply.switcherPath), true)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    removeTempDir(dir)
  }
})

test("chat answer reads the answer body from stdin when --text is omitted", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0700", title: "stdin item", description: "stdin" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    const stage = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-stdin", runId: run.id, stageRunId: stage.id, prompt: "  you > " })

    const result = spawnSync(
      process.execPath,
      [binPath, "chat", "answer", "--prompt", "p-stdin"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        input: "Answer from stdin\n",
        env: {
          ...process.env,
          BEERENGINEER_UI_DB_PATH: dbPath,
          EDITOR: "",
          VISUAL: "",
        },
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /answered p-stdin/)
    assert.equal(repos.getPendingPrompt("p-stdin")?.answer, "Answer from stdin")
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("chat answer supports explicit multiline stdin mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0800", title: "multiline item", description: "stdin" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    const stage = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-multiline", runId: run.id, stageRunId: stage.id, prompt: "  you > " })

    const result = spawnSync(
      process.execPath,
      [binPath, "chat", "answer", "--prompt", "p-multiline", "--multiline"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        input: "Line one\nLine two\n",
        env: {
          ...process.env,
          BEERENGINEER_UI_DB_PATH: dbPath,
          EDITOR: "",
          VISUAL: "",
        },
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.equal(repos.getPendingPrompt("p-multiline")?.answer, "Line one\nLine two")
  } finally {
    db.close()
    removeTempDir(dir)
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
    assert.match(add.stdout ?? "", /Optional: install the CLI with npm i -g @coderabbit\/cli/)
    assert.match(add.stdout ?? "", /beerengineer_ will skip CodeRabbit review for the workspace/)
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
    removeTempDir(dir)
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
    const config = JSON.parse(readFileSync(join(rootPath, ".beerengineer", "workspace.json"), "utf8")) as {
      key: string
      harnessProfile: { mode: string }
      runtimePolicy: { coderExecution: string }
    }
    assert.equal(config.key, "legacy")
    assert.equal(config.harnessProfile.mode, "fast")
    assert.equal(config.runtimePolicy.coderExecution, "unsafe-autonomous-write")
  } finally {
    removeTempDir(dir)
  }
})

test("PROJ-3-PRD-5 AC-12 public CLI verifies repair apply side effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-cap-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const dbPath = join(dir, "cap.sqlite")
  const rootPath = join(dir, "project")

  try {
    mkdirSync(join(rootPath, "src"), { recursive: true })
    await writeWorkspaceConfig(rootPath, buildWorkspaceConfigFile({
      key: "demo",
      name: "Demo",
      harnessProfile: { mode: "fast" },
      sonar: { enabled: true, organization: "acme", projectKey: "acme_demo" },
    }))
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    repos.upsertWorkspace({
      key: "demo",
      name: "Demo",
      rootPath,
      harnessProfileJson: JSON.stringify({ mode: "fast" }),
      sonarEnabled: true,
    })
    db.close()

    const result = spawnSync(process.execPath, [binPath, "workspace", "sonar", "repair", "demo", "--apply", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(join(rootPath, "sonar-project.properties")), true)
    assert.equal(existsSync(join(rootPath, ".github", "workflows", "sonar.yml")), true)
  } finally {
    removeTempDir(dir)
  }
})

test("resolveUiLaunchUrl uses the dedicated UI operator port", () => {
  assert.equal(new URL(resolveUiLaunchUrl()).port, "3100")
  assert.notEqual(new URL(resolveUiLaunchUrl()).hostname, "0.0.0.0")
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
    removeTempDir(dir)
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
  assert.match(`${result.stdout ?? ""}${result.stderr ?? ""}`, /beerengineer_ CLI/)
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
  assert.match(output, /promote_to_base/)
  assert.match(output, /cancel_promotion/)
  assert.match(output, /BEERENGINEER_WORKTREE_PORT_POOL/)
})

function buildCliAppConfig(dataDir: string, allowedRoot: string) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir,
    allowedRoots: [allowedRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    notifications: { telegram: { enabled: false, level: 2, inbound: { enabled: false } } },
    vcs: { github: { enabled: false } },
    recovery: { startupAutoResume: true },
    browser: { enabled: false },
  }
}

function writeCliAppConfig(configPath: string, config: ReturnType<typeof buildCliAppConfig>): void {
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8")
}

function readLegacyCleanupEvents(dataDir: string): Array<{
  event: string
  configuredDbPath: string
  legacyDbPath: string
  outcome: string
  timestamp?: string
}> {
  const logPath = resolveLegacyDbCleanupLogPath(dataDir)
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as {
      event: string
      configuredDbPath: string
      legacyDbPath: string
      outcome: string
      timestamp?: string
    })
}

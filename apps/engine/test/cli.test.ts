import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"
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
  assert.deepEqual(parseArgs(["notifications", "test", "telegram"]), { kind: "notifications-test", channel: "telegram" })
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
  assert.deepEqual(parseArgs(["workspace", "items", "demo", "--json"]), { kind: "workspace-items", key: "demo", json: true })
  assert.deepEqual(parseArgs(["workspace", "use", "demo"]), { kind: "workspace-use", key: "demo" })
  assert.deepEqual(parseArgs(["workspace", "remove", "demo", "--purge"]), { kind: "workspace-remove", key: "demo", json: false, purge: true })
  assert.deepEqual(parseArgs(["workspace", "open", "demo"]), { kind: "workspace-open", key: "demo" })
  assert.deepEqual(parseArgs(["workspace", "backfill", "--json"]), { kind: "workspace-backfill", json: true })
  assert.deepEqual(parseArgs(["chat", "list", "--workspace", "demo", "--json"]), { kind: "chat-list", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["chat", "list", "--all", "--json"]), { kind: "chat-list", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["chat", "list", "--all", "--compact"]), { kind: "chat-list", workspaceKey: undefined, json: false, all: true, compact: true })
  assert.deepEqual(parseArgs(["chat", "answer", "--prompt", "p-1", "--text", "Ship it"]), { kind: "chat-answer", promptId: "p-1", runId: undefined, answer: "Ship it", multiline: false, editor: false })
  assert.deepEqual(parseArgs(["chat", "answer", "--run", "r-1", "--multiline"]), { kind: "chat-answer", promptId: undefined, runId: "r-1", answer: undefined, multiline: true, editor: false })
  assert.deepEqual(parseArgs(["chat", "answer", "--run", "r-1", "--editor"]), { kind: "chat-answer", promptId: undefined, runId: "r-1", answer: undefined, multiline: false, editor: true })
  assert.deepEqual(parseArgs(["items", "--workspace", "demo", "--json"]), { kind: "items", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["items", "--all", "--json"]), { kind: "items", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["chats", "--workspace", "demo", "--json"]), { kind: "chats", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["chats", "--all", "--json"]), { kind: "chats", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["item", "get", "ITEM-0001", "--workspace", "demo", "--json"]), { kind: "item-get", itemRef: "ITEM-0001", workspaceKey: "demo", json: true })
  assert.deepEqual(parseArgs(["item", "open", "ITEM-0001", "--workspace", "demo"]), { kind: "item-open", itemRef: "ITEM-0001", workspaceKey: "demo" })
  assert.deepEqual(parseArgs(["run", "list", "--workspace", "demo", "--json"]), { kind: "run-list", workspaceKey: "demo", json: true, all: false, compact: false })
  assert.deepEqual(parseArgs(["run", "list", "--all", "--json"]), { kind: "run-list", workspaceKey: undefined, json: true, all: true, compact: false })
  assert.deepEqual(parseArgs(["run", "list", "--all", "--compact"]), { kind: "run-list", workspaceKey: undefined, json: false, all: true, compact: true })
  assert.deepEqual(parseArgs(["run", "get", "run-123", "--json"]), { kind: "run-get", runId: "run-123", json: true })
  assert.deepEqual(parseArgs(["run", "open", "run-123"]), { kind: "run-open", runId: "run-123" })
  assert.deepEqual(parseArgs(["run", "watch", "run-123"]), { kind: "run-watch", runId: "run-123" })
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
    assert.match(requests[0].body, /BeerEngineer test notification/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test("item open and run open print UI URLs based on publicBaseUrl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const previousConfigPath = process.env.BEERENGINEER_CONFIG_PATH
  const previousDisableOpen = process.env.BEERENGINEER_DISABLE_BROWSER_OPEN
  const dbPath = join(dir, "beerengineer.sqlite")
  const configPath = join(dir, "config.json")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    process.env.BEERENGINEER_CONFIG_PATH = configPath
    process.env.BEERENGINEER_DISABLE_BROWSER_OPEN = "1"
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

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["item", "open", "ITEM-0600", "--workspace", "demo"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["run", "open", run.id])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /http:\/\/100\.80\.38\.41:3100\/\?workspace=demo&item=ITEM-0600/)
    assert.match(stdout, new RegExp(`http://100\\.80\\.38\\.41:3100/runs/${run.id}`))
    assert.match(stdout, /UI is not reachable on that address; printed URL only\./)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    if (previousConfigPath === undefined) delete process.env.BEERENGINEER_CONFIG_PATH
    else process.env.BEERENGINEER_CONFIG_PATH = previousConfigPath
    if (previousDisableOpen === undefined) delete process.env.BEERENGINEER_DISABLE_BROWSER_OPEN
    else process.env.BEERENGINEER_DISABLE_BROWSER_OPEN = previousDisableOpen
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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

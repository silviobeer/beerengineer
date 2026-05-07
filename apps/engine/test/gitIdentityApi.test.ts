import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"

const TEST_API_TOKEN = "test-token"

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 5200 + Math.floor(Math.random() * 500)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stderr?.on("data", () => {})
  proc.stdout?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
}

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve()
    proc.once("exit", () => resolve())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

test("AC-20/21/22 workspace repair API resolves root server-side and ignores injected paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-git-identity-api-"))
  const dbPath = join(dir, "server.sqlite")
  const configPath = join(dir, "config.json")
  const dataDir = join(dir, "data")
  const realRepo = join(dir, "real")
  const injectedRepo = join(dir, "injected")
  const globalGitConfig = join(dir, "global.gitconfig")
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalGitConfig }
  spawnSync("git", ["init", "-b", "main", realRepo], { env, encoding: "utf8" })
  spawnSync("git", ["init", "-b", "main", injectedRepo], { env, encoding: "utf8" })
  writeConfigFile(configPath, { ...defaultAppConfig(), dataDir, allowedRoots: [dir] })
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: realRepo })
  db.close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: dataDir,
    GIT_CONFIG_GLOBAL: globalGitConfig,
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/setup/git-identity/repair`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        workspaceId: workspace.id,
        rootPath: injectedRepo,
        workspaceRoot: injectedRepo,
        identity: { displayName: "Repo User", email: "repo@example.test" },
      }),
    })

    assert.equal(res.status, 200)
    const realEmail = spawnSync("git", ["config", "--local", "--get", "user.email"], { cwd: realRepo, env, encoding: "utf8" })
    const injectedEmail = spawnSync("git", ["config", "--local", "--get", "user.email"], { cwd: injectedRepo, env, encoding: "utf8" })
    assert.equal(realEmail.stdout.trim(), "repo@example.test")
    assert.equal(injectedEmail.stdout.trim(), "")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("AC-23 unknown workspace repair returns workspace_not_found without Git side effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-git-identity-api-unknown-"))
  const dbPath = join(dir, "server.sqlite")
  const configPath = join(dir, "config.json")
  const dataDir = join(dir, "data")
  writeConfigFile(configPath, { ...defaultAppConfig(), dataDir })
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: dataDir,
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/setup/git-identity/repair`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        workspaceId: "missing",
        identity: { displayName: "Repo User", email: "repo@example.test" },
      }),
    })

    assert.equal(res.status, 404)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "workspace_not_found")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("git identity API routes are represented in the OpenAPI contract", () => {
  const openapi = JSON.stringify(JSON.parse(readFileSync(resolve("src/api/openapi.json"), "utf8")))
  assert.match(openapi, /setup\/git-readiness/)
  assert.match(openapi, /setup\/git-identity/)
})

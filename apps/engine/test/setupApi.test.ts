import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"

const TEST_API_TOKEN = "test-token"

function startServer(env: NodeJS.ProcessEnv, options?: { apiToken?: string | null }): { proc: ChildProcess; base: string } {
  const port = 4700 + Math.floor(Math.random() * 500)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const childEnv = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOST: host,
    BEERENGINEER_SEED: "0",
  }
  const apiToken = options?.apiToken === undefined ? TEST_API_TOKEN : options.apiToken
  if (apiToken) childEnv.BEERENGINEER_API_TOKEN = apiToken
  else delete childEnv.BEERENGINEER_API_TOKEN
  if (!("BEERENGINEER_PUBLIC_BASE_URL" in env)) delete childEnv.BEERENGINEER_PUBLIC_BASE_URL
  if (!("BEERENGINEER_PREVIEW_HOST" in env)) delete childEnv.BEERENGINEER_PREVIEW_HOST
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: childEnv,
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

test("REQ-1 POST /setup/init succeeds for localhost operators without token management", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-api-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)
    const accepted = await fetch(`${base}/setup/init`, { method: "POST" })
    assert.equal(accepted.status, 200)
    const body = await accepted.json() as { ok: boolean; configState: string }
    assert.equal(body.ok, true)
    assert.equal(body.configState, "created")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 PATCH /setup/config allows tokenless localhost updates and ignores legacy headers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-config-api-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)
    const rejected = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browser: { enabled: true } }),
    })
    assert.equal(rejected.status, 409)

    const initialized = await fetch(`${base}/setup/init`, {
      method: "POST",
    })
    assert.equal(initialized.status, 200)

    const patched = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browser: { enabled: true } }),
    })
    assert.equal(patched.status, 200)
    const body = await patched.json() as { saved: string[] }
    assert.deepEqual(body.saved, ["browser.enabled"])

    const legacyHeaderPatched = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-beerengineer-token": TEST_API_TOKEN },
      body: JSON.stringify({ browser: { enabled: false } }),
    })
    assert.equal(legacyHeaderPatched.status, 200)
    const legacyBody = await legacyHeaderPatched.json() as { saved: string[] }
    assert.deepEqual(legacyBody.saved, ["browser.enabled"])
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setup JSON endpoints reject oversized request bodies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-api-body-limit-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  })
  try {
    await waitForHealth(base)
    const rejected = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-beerengineer-token": TEST_API_TOKEN },
      body: JSON.stringify({ payload: "x".repeat(1024 * 1024 + 1) }),
    })

    assert.equal(rejected.status, 413)
    const body = await rejected.json() as { error: string }
    assert.equal(body.error, "request_body_too_large")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 startup stays tokenless and does not create an api.token artifact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-api-tokenless-"))
  const dbPath = join(dir, "server.sqlite")
  const stateDir = join(dir, "state")
  const tokenPath = join(stateDir, "beerengineer", "api.token")
  initDatabase(dbPath).close()

  const serverEnv = {
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
    XDG_STATE_HOME: stateDir,
  }

  const first = startServer(serverEnv, { apiToken: null })
  try {
    await waitForHealth(first.base)
    assert.equal(existsSync(tokenPath), false)
  } finally {
    await stopServer(first.proc)
  }

  const second = startServer(serverEnv, { apiToken: null })
  try {
    await waitForHealth(second.base)
    assert.equal(existsSync(tokenPath), false)
  } finally {
    await stopServer(second.proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

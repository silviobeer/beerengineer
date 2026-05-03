import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"

const TEST_API_TOKEN = "test-token"

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4700 + Math.floor(Math.random() * 500)
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

test("AC-8 POST /setup/init requires the engine CSRF token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-api-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  })
  try {
    await waitForHealth(base)
    const rejected = await fetch(`${base}/setup/init`, { method: "POST" })
    assert.equal(rejected.status, 403)

    const accepted = await fetch(`${base}/setup/init`, {
      method: "POST",
      headers: { "x-beerengineer-token": TEST_API_TOKEN },
    })
    assert.equal(accepted.status, 200)
    const body = await accepted.json() as { ok: boolean; configState: string }
    assert.equal(body.ok, true)
    assert.equal(body.configState, "created")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("AC-16 PATCH /setup/config requires the engine CSRF token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-config-api-"))
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
      body: JSON.stringify({ browser: { enabled: true } }),
    })
    assert.equal(rejected.status, 403)

    const accepted = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-beerengineer-token": TEST_API_TOKEN },
      body: JSON.stringify({ browser: { enabled: true } }),
    })
    assert.equal(accepted.status, 409)

    const initialized = await fetch(`${base}/setup/init`, {
      method: "POST",
      headers: { "x-beerengineer-token": TEST_API_TOKEN },
    })
    assert.equal(initialized.status, 200)

    const patched = await fetch(`${base}/setup/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-beerengineer-token": TEST_API_TOKEN },
      body: JSON.stringify({ browser: { enabled: true } }),
    })
    assert.equal(patched.status, 200)
    const body = await patched.json() as { saved: string[] }
    assert.deepEqual(body.saved, ["browser.enabled"])
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

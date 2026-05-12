import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"

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

test("REQ-1 localhost secret actions stay redacted without requiring a token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-api-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
    BEERENGINEER_SECRET_STORE_PATH: join(dir, "secrets.json"),
  })
  try {
    await waitForHealth(base)
    const acceptedWithoutToken = await fetch(`${base}/setup/secrets/sonar.token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "replace", value: "api-secret-value" }),
    })
    assert.equal(acceptedWithoutToken.status, 200)

    const accepted = await fetch(`${base}/setup/secrets/sonar.token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-beerengineer-token": TEST_API_TOKEN },
      body: JSON.stringify({ action: "replace", value: "api-secret-value" }),
    })
    assert.equal(accepted.status, 200)
    const body = await accepted.json()
    assert.equal(body.ok, true)
    assert.doesNotMatch(JSON.stringify(body), /api-secret-value/)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

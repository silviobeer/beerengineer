import assert from "node:assert/strict"
import { request as httpRequest } from "node:http"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { networkInterfaces } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"

const TEST_API_TOKEN = "test-token"

function formatBaseUrl(host: string, port: number): string {
  return host.includes(":") ? `http://[${host}]:${port}` : `http://${host}:${port}`
}

async function reservePort(host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error(`failed to reserve port for ${host}`)))
        return
      }
      server.close(err => err ? reject(err) : resolve(address.port))
    })
  })
}

function findNonLoopbackAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== "IPv4") continue
      return entry.address
    }
  }
  throw new Error("no non-loopback IPv4 address available for auth boundary test")
}

type StartServerOptions = {
  apiToken?: string | null
  bindHost?: string
  connectHost?: string
}

async function startServer(env: NodeJS.ProcessEnv, options?: StartServerOptions): Promise<{ proc: ChildProcess; base: string }> {
  const bindHost = options?.bindHost ?? "127.0.0.1"
  const connectHost = options?.connectHost ?? bindHost
  const port = await reservePort(bindHost)
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const childEnv = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOST: bindHost,
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
  return { proc, base: formatBaseUrl(connectHost, port) }
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

async function postJson(
  base: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
}

async function postJsonViaHttp(
  base: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const url = new URL(`${base}${path}`)
  const payload = JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(headers ?? {}),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      },
    )
    req.once("error", reject)
    req.end(payload)
  })
}

test("REQ-1 POST /setup/init succeeds for localhost operators without token management", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-api-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
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
  const { proc, base } = await startServer({
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
  const { proc, base } = await startServer({
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

  const first = await startServer(serverEnv, { apiToken: null })
  try {
    await waitForHealth(first.base)
    assert.equal(existsSync(tokenPath), false)
  } finally {
    await stopServer(first.proc)
  }

  const second = await startServer(serverEnv, { apiToken: null })
  try {
    await waitForHealth(second.base)
    assert.equal(existsSync(tokenPath), false)
  } finally {
    await stopServer(second.proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 POST /runs succeeds on IPv4 loopback without any token inputs after setup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-runs-loopback-ipv4-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)

    const setup = await fetch(`${base}/setup/init`, { method: "POST" })
    assert.equal(setup.status, 200)

    const created = await postJson(base, "/runs", {
      title: "Loopback run creation",
      description: "local operator flow",
    })
    assert.equal(created.status, 202)
    const body = await created.json() as { runId?: string; itemId?: string; status?: string }
    assert.match(body.runId ?? "", /\S+/)
    assert.match(body.itemId ?? "", /\S+/)
    assert.match(body.status ?? "", /\S+/)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 loopback POST /runs treats missing and stale token headers the same for valid bodies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-runs-loopback-valid-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)
    assert.equal((await fetch(`${base}/setup/init`, { method: "POST" })).status, 200)

    const withoutHeader = await postJson(base, "/runs", { title: "No header", description: "loopback" })
    const withStaleHeader = await postJson(
      base,
      "/runs",
      { title: "Wrong header", description: "loopback" },
      { "x-beerengineer-token": "stale-token" },
    )

    assert.equal(withoutHeader.status, 202)
    assert.equal(withStaleHeader.status, 202)

    const withoutBody = await withoutHeader.json() as { runId?: string; itemId?: string; status?: string }
    const staleBody = await withStaleHeader.json() as { runId?: string; itemId?: string; status?: string }

    for (const body of [withoutBody, staleBody]) {
      assert.match(body.runId ?? "", /\S+/)
      assert.match(body.itemId ?? "", /\S+/)
      assert.match(body.status ?? "", /\S+/)
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 loopback POST /runs keeps the same validation error with and without a stale token header", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-runs-loopback-invalid-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)
    assert.equal((await fetch(`${base}/setup/init`, { method: "POST" })).status, 200)

    const withoutHeader = await postJson(base, "/runs", { description: "missing title" })
    const withStaleHeader = await postJson(
      base,
      "/runs",
      { description: "missing title" },
      { "x-beerengineer-token": "stale-token" },
    )

    assert.equal(withoutHeader.status, 400)
    assert.equal(withStaleHeader.status, 400)
    const withoutBody = await withoutHeader.json()
    const staleBody = await withStaleHeader.json()
    assert.deepEqual(withoutBody, staleBody)
    assert.deepEqual(withoutBody, { error: "title is required", code: "bad_request" })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 no-token localhost setup and run creation also work over IPv6 loopback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-runs-loopback-ipv6-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null, bindHost: "::1" })
  try {
    await waitForHealth(base)

    const setup = await fetch(`${base}/setup/init`, { method: "POST" })
    assert.equal(setup.status, 200)

    const created = await postJson(base, "/runs", {
      title: "IPv6 loopback run",
      description: "local operator flow",
    })
    assert.equal(created.status, 202)
    const body = await created.json() as { runId?: string; itemId?: string; status?: string }
    assert.match(body.runId ?? "", /\S+/)
    assert.match(body.itemId ?? "", /\S+/)
    assert.match(body.status ?? "", /\S+/)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 non-loopback callers stay blocked without a token even when Host claims localhost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-runs-non-loopback-"))
  const dbPath = join(dir, "server.sqlite")
  const nonLoopbackAddress = findNonLoopbackAddress()
  initDatabase(dbPath).close()
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, {
    apiToken: null,
    bindHost: "0.0.0.0",
    connectHost: nonLoopbackAddress,
  })
  try {
    await waitForHealth(base)
    const spoofedHost = `localhost:${new URL(base).port}`

    const ordinary = await postJson(base, "/runs", {
      title: "Non-loopback run",
      description: "should be rejected",
    })
    assert.equal(ordinary.status, 403)
    assert.deepEqual(await ordinary.json(), {
      error: "forbidden",
      code: "non_local_mutation_forbidden",
    })

    const spoofed = await postJsonViaHttp(
      base,
      "/runs",
      { title: "Spoofed host", description: "should still be rejected" },
      { host: spoofedHost },
    )
    assert.equal(spoofed.status, 403)
    assert.deepEqual(JSON.parse(spoofed.body), {
      error: "forbidden",
      code: "non_local_mutation_forbidden",
    })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

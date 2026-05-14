import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import type { ServerResponse } from "node:http"

import type { ApiHttpShell, ApiRequest, ApiRequestHandler, ApiLifecycleView } from "../src/api/entrypointContracts.js"
import { composeApiPrivilegedDependencies } from "../src/api/privilegedDependencies.js"
import { registerApiRoutes } from "../src/api/routeRegistration.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"
const TEST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)))
const SERVER_PATH = resolve(TEST_DIR, "..", "src", "api", "server.ts")
const SERVER_START_RETRIES = 5

type ServerHandle = {
  proc: ChildProcess
  base: string
}

type SeededPrompt = {
  promptId: string
  runId: string
  workspaceKey: string
  text: string
  createdAt: string
  actions?: Array<{ label: string; value: string }>
}

type PromptInboxResponse = {
  prompts: Array<{
    promptId: string
    runId: string
    workspaceKey: string
    text: string
    createdAt: string
    actions?: Array<{ label: string; value: string }>
  }>
}

type SeededFixture = {
  openAcrossWorkspaces: SeededPrompt[]
  byWorkspace: Record<string, SeededPrompt[]>
}

function iso(ts: number): string {
  return new Date(ts).toISOString()
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to reserve port")))
        return
      }
      server.close(err => err ? reject(err) : resolvePort(address.port))
    })
  })
}

async function startServer(env: NodeJS.ProcessEnv, options?: { apiToken?: string | null }): Promise<ServerHandle> {
  const host = "127.0.0.1"
  let lastError: Error | null = null

  for (let attempt = 0; attempt < SERVER_START_RETRIES; attempt++) {
    const port = await reservePort()
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

    const proc = spawn(process.execPath, ["--import", "tsx", SERVER_PATH], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    proc.stderr?.on("data", chunk => {
      stderr += chunk.toString()
    })
    proc.stdout?.on("data", () => {})

    const startup = await new Promise<"running" | "retry" | "failed">(resolveStartup => {
      let settled = false
      const finish = (result: "running" | "retry" | "failed") => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveStartup(result)
      }
      const timer = setTimeout(() => finish("running"), 250)
      proc.once("exit", () => {
        finish(/EADDRINUSE/.test(stderr) ? "retry" : "failed")
      })
    })

    if (startup === "running") return { proc, base: `http://${host}:${port}` }
    if (startup === "retry") {
      lastError = new Error(`server port ${port} was claimed before bind`)
      continue
    }

    lastError = new Error(stderr.trim() || `server exited during startup on port ${port}`)
    break
  }

  throw lastError ?? new Error("failed to start test server")
}

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolveStop => {
    if (proc.exitCode !== null) return resolveStop()
    proc.once("exit", () => resolveStop())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function makeServerEnv(dir: string, dbPath: string): NodeJS.ProcessEnv {
  return {
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }
}

function seedPromptFixture(dbPath: string): SeededFixture {
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    const alpha = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
    const beta = repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: "/tmp/beta" })
    repos.upsertWorkspace({ key: "gamma", name: "Gamma", rootPath: "/tmp/gamma" })

    const alphaItem = repos.createItem({ workspaceId: alpha.id, code: "ITEM-0001", title: "Alpha prompt", description: "alpha" })
    const alphaRun = repos.createRun({ workspaceId: alpha.id, itemId: alphaItem.id, title: alphaItem.title, owner: "api" })
    repos.updateRun(alphaRun.id, { status: "running", current_stage: "requirements" })
    const alphaOlder = repos.createPendingPrompt({
      id: "prompt-alpha-older",
      runId: alphaRun.id,
      prompt: "Ignore this older alpha prompt.",
    })
    const alphaCurrent = repos.createPendingPrompt({
      id: "prompt-alpha-open",
      runId: alphaRun.id,
      prompt: "Choose the recovery path.",
      actions: [
        { label: "Retry retained", value: "retry_retained" },
        { label: "Clear and fresh", value: "clear_and_fresh" },
      ],
    })

    const betaItem = repos.createItem({ workspaceId: beta.id, code: "ITEM-0002", title: "Beta prompt", description: "beta" })
    const betaRun = repos.createRun({ workspaceId: beta.id, itemId: betaItem.id, title: betaItem.title, owner: "api" })
    repos.updateRun(betaRun.id, { status: "running", current_stage: "execution" })
    const betaCurrent = repos.createPendingPrompt({
      id: "prompt-beta-open",
      runId: betaRun.id,
      prompt: "Provide the rollout note.",
    })

    const answeredItem = repos.createItem({ workspaceId: alpha.id, code: "ITEM-0003", title: "Answered prompt", description: "answered" })
    const answeredRun = repos.createRun({ workspaceId: alpha.id, itemId: answeredItem.id, title: answeredItem.title, owner: "api" })
    repos.updateRun(answeredRun.id, { status: "running", current_stage: "implementation" })
    const answeredPrompt = repos.createPendingPrompt({
      id: "prompt-alpha-answered",
      runId: answeredRun.id,
      prompt: "This prompt is already answered.",
    })
    repos.answerPendingPrompt(answeredPrompt.id, "answered")

    const alphaOlderTs = Date.UTC(2026, 4, 14, 8, 0, 0, 0)
    const alphaCurrentTs = Date.UTC(2026, 4, 14, 8, 5, 0, 0)
    const betaCurrentTs = Date.UTC(2026, 4, 14, 8, 10, 0, 0)
    const answeredTs = Date.UTC(2026, 4, 14, 7, 55, 0, 0)

    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(alphaOlderTs, alphaOlder.id)
    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(alphaCurrentTs, alphaCurrent.id)
    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(betaCurrentTs, betaCurrent.id)
    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(answeredTs, answeredPrompt.id)

    const alphaExpected: SeededPrompt = {
      promptId: alphaCurrent.id,
      runId: alphaRun.id,
      workspaceKey: alpha.key,
      text: alphaCurrent.prompt,
      createdAt: iso(alphaCurrentTs),
      actions: [
        { label: "Retry retained", value: "retry_retained" },
        { label: "Clear and fresh", value: "clear_and_fresh" },
      ],
    }
    const betaExpected: SeededPrompt = {
      promptId: betaCurrent.id,
      runId: betaRun.id,
      workspaceKey: beta.key,
      text: betaCurrent.prompt,
      createdAt: iso(betaCurrentTs),
    }

    return {
      openAcrossWorkspaces: [alphaExpected, betaExpected],
      byWorkspace: {
        alpha: [alphaExpected],
        beta: [betaExpected],
        gamma: [],
      },
    }
  } finally {
    db.close()
  }
}

async function invokePromptRoute(
  env: NodeJS.ProcessEnv,
  input: {
    path: string
    remoteAddress: string
    headers?: Record<string, string>
    apiToken?: string
  },
): Promise<{ statusCode: number; body: unknown }> {
  const originalEnv = {
    BEERENGINEER_UI_DB_PATH: process.env.BEERENGINEER_UI_DB_PATH,
    BEERENGINEER_CONFIG_PATH: process.env.BEERENGINEER_CONFIG_PATH,
    BEERENGINEER_DATA_DIR: process.env.BEERENGINEER_DATA_DIR,
    BEERENGINEER_SEED: process.env.BEERENGINEER_SEED,
  }

  let boundHandler: ApiRequestHandler | null = null
  const shell: ApiHttpShell = {
    setRequestHandler(handler): void {
      boundHandler = handler
    },
    async listen(): Promise<void> {
      throw new Error("not used in prompt inbox route test")
    },
    async close(): Promise<Error | undefined> {
      return undefined
    },
    destroyTrackedSocketsAfter(): void {},
    destroyTrackedSockets(): void {},
  }
  const lifecycle: ApiLifecycleView = {
    isStartupRecoveryComplete: () => true,
    isShutdownInFlight: () => false,
    requestShutdown: async () => {},
  }

  try {
    process.env.BEERENGINEER_UI_DB_PATH = env.BEERENGINEER_UI_DB_PATH
    process.env.BEERENGINEER_CONFIG_PATH = env.BEERENGINEER_CONFIG_PATH
    process.env.BEERENGINEER_DATA_DIR = env.BEERENGINEER_DATA_DIR
    process.env.BEERENGINEER_SEED = "0"

    const dependencies = composeApiPrivilegedDependencies({
      host: "127.0.0.1",
      port: 4100,
      apiToken: input.apiToken ?? TEST_API_TOKEN,
    })
    registerApiRoutes(shell, dependencies.routeDependencies, lifecycle)
    assert.ok(boundHandler, "route registration must bind a handler")

    let statusCode = 200
    let rawBody = ""
    const res = {
      headersSent: false,
      destroyed: false,
      writableEnded: false,
      setHeader(): void {},
      writeHead(nextStatus: number): ServerResponse {
        statusCode = nextStatus
        this.headersSent = true
        return this as unknown as ServerResponse
      },
      end(chunk?: string | Uint8Array): ServerResponse {
        if (chunk) rawBody += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
        this.writableEnded = true
        return this as unknown as ServerResponse
      },
    } as unknown as ServerResponse

    const req = {
      url: input.path,
      method: "GET",
      headers: input.headers ?? {},
      socket: { remoteAddress: input.remoteAddress },
      [Symbol.asyncIterator]: async function* () {},
    } as unknown as ApiRequest

    await boundHandler(req, res)
    dependencies.lifecycleHooks.closeDatabase()
    return { statusCode, body: rawBody ? JSON.parse(rawBody) : null }
  } finally {
    process.env.BEERENGINEER_UI_DB_PATH = originalEnv.BEERENGINEER_UI_DB_PATH
    process.env.BEERENGINEER_CONFIG_PATH = originalEnv.BEERENGINEER_CONFIG_PATH
    process.env.BEERENGINEER_DATA_DIR = originalEnv.BEERENGINEER_DATA_DIR
    process.env.BEERENGINEER_SEED = originalEnv.BEERENGINEER_SEED
  }
}

test("REQ-1 TC-REQ1-1/2/3/4/6: prompts inbox returns the canonical open prompts with workspace scoping and structured actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompts-inbox-"))
  const dbPath = join(dir, "server.sqlite")
  const expected = seedPromptFixture(dbPath)
  const { proc, base } = await startServer(makeServerEnv(dir, dbPath), { apiToken: null })

  try {
    await waitForHealth(base)

    const res = await fetch(`${base}/prompts?status=open`)
    assert.equal(res.status, 200)
    const body = await res.json() as PromptInboxResponse
    assert.deepEqual(body.prompts, expected.openAcrossWorkspaces)

    const alphaRes = await fetch(`${base}/prompts?status=open&workspaceKey=alpha`)
    assert.equal(alphaRes.status, 200)
    const alphaBody = await alphaRes.json() as PromptInboxResponse
    assert.deepEqual(alphaBody.prompts, expected.byWorkspace.alpha)

    const gammaRes = await fetch(`${base}/prompts?status=open&workspaceKey=gamma`)
    assert.equal(gammaRes.status, 200)
    const gammaBody = await gammaRes.json() as PromptInboxResponse
    assert.deepEqual(gammaBody, { prompts: [] })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 TC-REQ1-5/7: prompts inbox returns an explicit empty shape and rejects unsupported statuses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompts-inbox-empty-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer(makeServerEnv(dir, dbPath), { apiToken: null })

  try {
    await waitForHealth(base)

    const emptyRes = await fetch(`${base}/prompts?status=open`)
    assert.equal(emptyRes.status, 200)
    assert.deepEqual(await emptyRes.json(), { prompts: [] })

    for (const status of ["closed", "banana", ""]) {
      const suffix = status ? `?status=${status}` : ""
      const res = await fetch(`${base}/prompts${suffix}`)
      assert.equal(res.status, 400)
      const body = await res.json() as { error: string; code?: string; message?: string }
      assert.equal(body.error, "unsupported_prompt_status")
      assert.equal(body.code, "bad_request")
      assert.match(body.message ?? "", /Only status=open is supported/)
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 TC-REQ1-8/9: prompts inbox accepts admitted loopback callers and blocks non-admitted callers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompts-inbox-admission-"))
  const dbPath = join(dir, "server.sqlite")
  seedPromptFixture(dbPath)
  const env = makeServerEnv(dir, dbPath)
  const { proc, base } = await startServer(env, { apiToken: null })

  try {
    await waitForHealth(base)

    const loopbackRes = await fetch(`${base}/prompts?status=open`)
    assert.equal(loopbackRes.status, 200)
    assert.deepEqual((await loopbackRes.json() as PromptInboxResponse).prompts.length > 0, true)

    const rejected = await invokePromptRoute(env, {
      path: "/prompts?status=open",
      remoteAddress: "10.0.0.24",
    })
    assert.equal(rejected.statusCode, 403)
    assert.deepEqual(rejected.body, { error: "forbidden", code: "non_local_mutation_forbidden" })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

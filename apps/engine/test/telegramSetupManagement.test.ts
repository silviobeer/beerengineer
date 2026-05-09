import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"

const TEST_API_TOKEN = "test-token"

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-telegram-setup-management-"))
  return {
    dir,
    dbPath: join(dir, "server.sqlite"),
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

function startEngineServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4900 + Math.floor(Math.random() * 400)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const childEnv = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOST: host,
    BEERENGINEER_SEED: "0",
    BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
  }
  if (!("BEERENGINEER_PUBLIC_BASE_URL" in env)) delete childEnv.BEERENGINEER_PUBLIC_BASE_URL
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stderr?.on("data", () => {})
  proc.stdout?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
}

async function waitForHealth(base: string, timeoutMs = 5_000): Promise<void> {
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

function stopProcess(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve()
    proc.once("exit", () => resolve())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1_500).unref?.()
  })
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T
}

type FakeTelegramState = {
  expectedToken: string
  webhookInfo: {
    url: string
    pending_update_count: number
    has_custom_certificate: boolean
    ip_address?: string
    last_error_message?: string
  }
  sendMessageCalls: Array<{ chat_id: string; text: string }>
  nextMessageId: number
  rejectSetWebhook?: { description: string }
  reportedWebhookUrl?: string
}

async function withFakeTelegramProvider<T>(
  initial: Partial<FakeTelegramState>,
  run: (ctx: { baseUrl: string; state: FakeTelegramState }) => Promise<T>,
): Promise<T> {
  const state: FakeTelegramState = {
    expectedToken: initial.expectedToken ?? "bot-secret",
    webhookInfo: initial.webhookInfo ?? {
      url: "",
      pending_update_count: 0,
      has_custom_certificate: false,
    },
    sendMessageCalls: [],
    nextMessageId: initial.nextMessageId ?? 7_001,
    rejectSetWebhook: initial.rejectSetWebhook,
    reportedWebhookUrl: initial.reportedWebhookUrl,
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const match = /^\/bot([^/]+)\/([^/?]+)$/.exec(req.url ?? "")
    if (!match) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: false, description: "not found" }))
      return
    }

    const [, token, method] = match
    if (token !== state.expectedToken) {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(JSON.stringify({
        ok: false,
        error_code: 401,
        description: `telegram rejected bot token ${token} with secret hook-secret`,
      }))
      return
    }

    if (method === "setWebhook") {
      const body = await readJsonBody<{ url?: string }>(req)
      if (state.rejectSetWebhook) {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error_code: 400, description: state.rejectSetWebhook.description }))
        return
      }
      state.webhookInfo.url = state.reportedWebhookUrl ?? body.url ?? ""
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, result: true }))
      return
    }

    if (method === "getWebhookInfo") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, result: state.webhookInfo }))
      return
    }

    if (method === "sendMessage") {
      const body = await readJsonBody<{ chat_id: string; text: string }>(req)
      state.sendMessageCalls.push(body)
      const messageId = state.nextMessageId++
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, result: { message_id: messageId } }))
      return
    }

    if (method === "setMessageReaction") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, result: true }))
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: false, description: "unknown method" }))
  })

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("expected fake Telegram server to bind a TCP port")
  try {
    return await run({ baseUrl: `http://127.0.0.1:${address.port}`, state })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test("REQ-2 setup route registers webhook, reports provider state, and keeps live verification separate", async () => {
  await withFakeTelegramProvider({}, async ({ baseUrl, state }) => {
    const paths = tempPaths()
    initDatabase(paths.dbPath).close()
    mkdirSync(paths.dataDir, { recursive: true })
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      publicBaseUrl: "https://operator.example.test",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "10001",
          inbound: {
            enabled: true,
            webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET",
          },
        },
      },
    })

    const { proc, base } = startEngineServer({
      BEERENGINEER_UI_DB_PATH: paths.dbPath,
      BEERENGINEER_CONFIG_PATH: paths.configPath,
      BEERENGINEER_DATA_DIR: paths.dataDir,
      BEERENGINEER_TELEGRAM_API_BASE_URL: baseUrl,
      TELEGRAM_BOT_TOKEN: "bot-secret",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
      BEERENGINEER_TELEGRAM_VERIFICATION_TIMEOUT_MS: "1000",
    })

    try {
      await waitForHealth(base)

      const setupRes = await fetch(`${base}/setup/telegram/webhook`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(setupRes.status, 200, await setupRes.clone().text())
      const setupBody = await setupRes.json() as {
        ok: boolean
        baseline: { state: string }
        liveVerification: { state: string }
        provider: { url: string }
      }
      assert.equal(setupBody.ok, true)
      assert.equal(setupBody.baseline.state, "ready")
      assert.equal(setupBody.liveVerification.state, "not-run")
      assert.equal(setupBody.provider.url, "https://operator.example.test/webhooks/telegram")

      const statusRes = await fetch(`${base}/setup/config`)
      assert.equal(statusRes.status, 200)
      const statusBody = await statusRes.json() as {
        telegramInbound: {
          baseline: { state: string }
          liveVerification: { state: string }
        }
      }
      assert.equal(statusBody.telegramInbound.baseline.state, "ready")
      assert.equal(statusBody.telegramInbound.liveVerification.state, "not-run")

      const verifyRes = await fetch(`${base}/setup/telegram/verification`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(verifyRes.status, 200)
      const verifyBody = await verifyRes.json() as {
        ok: boolean
        liveVerification: { state: string }
      }
      assert.equal(verifyBody.ok, true)
      assert.equal(verifyBody.liveVerification.state, "pending")
      assert.equal(state.sendMessageCalls.length, 1)

      const verificationMessageId = state.nextMessageId - 1
      const webhookRes = await fetch(`${base}/webhooks/telegram`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "hook-secret",
        },
        body: JSON.stringify({
          message: {
            message_id: 9_002,
            chat: { id: 10001 },
            text: "verification reply",
            reply_to_message: { message_id: verificationMessageId },
          },
        }),
      })
      assert.equal(webhookRes.status, 200)

      const verifiedStatusRes = await fetch(`${base}/setup/config`)
      assert.equal(verifiedStatusRes.status, 200)
      const verifiedStatusBody = await verifiedStatusRes.json() as {
        telegramInbound: {
          baseline: { state: string }
          liveVerification: { state: string }
        }
      }
      assert.equal(verifiedStatusBody.telegramInbound.baseline.state, "ready")
      assert.equal(verifiedStatusBody.telegramInbound.liveVerification.state, "succeeded")
    } finally {
      await stopProcess(proc)
      rmSync(paths.dir, { recursive: true, force: true })
    }
  })
})

test("REQ-2 setup rejects non-HTTPS callback URLs locally with a concrete reason", async () => {
  await withFakeTelegramProvider({}, async ({ baseUrl }) => {
    const paths = tempPaths()
    initDatabase(paths.dbPath).close()
    mkdirSync(paths.dataDir, { recursive: true })
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      publicBaseUrl: "http://operator.example.test",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "10001",
          inbound: {
            enabled: true,
            webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET",
          },
        },
      },
    })

    const { proc, base } = startEngineServer({
      BEERENGINEER_UI_DB_PATH: paths.dbPath,
      BEERENGINEER_CONFIG_PATH: paths.configPath,
      BEERENGINEER_DATA_DIR: paths.dataDir,
      BEERENGINEER_TELEGRAM_API_BASE_URL: baseUrl,
      TELEGRAM_BOT_TOKEN: "bot-secret",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    })

    try {
      await waitForHealth(base)
      const res = await fetch(`${base}/setup/telegram/webhook`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(res.status, 400)
      const body = await res.json() as { ok: boolean; message: string }
      assert.equal(body.ok, false)
      assert.match(body.message, /https/i)
    } finally {
      await stopProcess(proc)
      rmSync(paths.dir, { recursive: true, force: true })
    }
  })
})

test("REQ-2 setup redacts Telegram-side rejection and keeps baseline status blocked", async () => {
  await withFakeTelegramProvider({}, async ({ baseUrl }) => {
    const paths = tempPaths()
    initDatabase(paths.dbPath).close()
    mkdirSync(paths.dataDir, { recursive: true })
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      publicBaseUrl: "https://operator.example.test",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "10001",
          inbound: {
            enabled: true,
            webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET",
          },
        },
      },
    })

    const { proc, base } = startEngineServer({
      BEERENGINEER_UI_DB_PATH: paths.dbPath,
      BEERENGINEER_CONFIG_PATH: paths.configPath,
      BEERENGINEER_DATA_DIR: paths.dataDir,
      BEERENGINEER_TELEGRAM_API_BASE_URL: baseUrl,
      TELEGRAM_BOT_TOKEN: "bad-token",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    })

    try {
      await waitForHealth(base)
      const res = await fetch(`${base}/setup/telegram/webhook`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(res.status, 400)
      const body = await res.json() as { ok: boolean; message: string }
      assert.equal(body.ok, false)
      assert.match(body.message, /telegram/i)
      assert.doesNotMatch(body.message, /bad-token/)
      assert.doesNotMatch(body.message, /hook-secret/)

      const statusRes = await fetch(`${base}/setup/config`)
      assert.equal(statusRes.status, 200)
      const statusBody = await statusRes.json() as {
        telegramInbound: {
          baseline: { state: string; message?: string }
        }
      }
      assert.equal(statusBody.telegramInbound.baseline.state, "blocked")
      assert.doesNotMatch(statusBody.telegramInbound.baseline.message ?? "", /bad-token/)
      assert.doesNotMatch(statusBody.telegramInbound.baseline.message ?? "", /hook-secret/)
    } finally {
      await stopProcess(proc)
      rmSync(paths.dir, { recursive: true, force: true })
    }
  })
})

test("REQ-2 live verification timeout stays distinct from baseline readiness", async () => {
  await withFakeTelegramProvider({}, async ({ baseUrl }) => {
    const paths = tempPaths()
    initDatabase(paths.dbPath).close()
    mkdirSync(paths.dataDir, { recursive: true })
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      publicBaseUrl: "https://operator.example.test",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "10001",
          inbound: {
            enabled: true,
            webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET",
          },
        },
      },
    })

    const { proc, base } = startEngineServer({
      BEERENGINEER_UI_DB_PATH: paths.dbPath,
      BEERENGINEER_CONFIG_PATH: paths.configPath,
      BEERENGINEER_DATA_DIR: paths.dataDir,
      BEERENGINEER_TELEGRAM_API_BASE_URL: baseUrl,
      TELEGRAM_BOT_TOKEN: "bot-secret",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
      BEERENGINEER_TELEGRAM_VERIFICATION_TIMEOUT_MS: "5",
    })

    try {
      await waitForHealth(base)
      const setupRes = await fetch(`${base}/setup/telegram/webhook`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(setupRes.status, 200, await setupRes.clone().text())

      const verifyRes = await fetch(`${base}/setup/telegram/verification`, {
        method: "POST",
        headers: { "x-beerengineer-token": TEST_API_TOKEN },
      })
      assert.equal(verifyRes.status, 200)

      await new Promise(resolve => setTimeout(resolve, 25))

      const statusRes = await fetch(`${base}/setup/config`)
      assert.equal(statusRes.status, 200)
      const statusBody = await statusRes.json() as {
        telegramInbound: {
          baseline: { state: string }
          liveVerification: { state: string }
        }
      }
      assert.equal(statusBody.telegramInbound.baseline.state, "ready")
      assert.equal(statusBody.telegramInbound.liveVerification.state, "timed_out")
    } finally {
      await stopProcess(proc)
      rmSync(paths.dir, { recursive: true, force: true })
    }
  })
})

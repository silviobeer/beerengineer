import assert from "node:assert/strict"
import { IncomingMessage, ServerResponse } from "node:http"
import { Socket } from "node:net"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { projectWorkflowEvent } from "../src/core/messagingProjection.js"
import { Repos } from "../src/db/repositories.js"
import { TelegramNotificationDispatcher } from "../src/notifications/dispatcher.js"
import {
  handleTelegramWebhook,
  resetTelegramWebhookRateLimit,
} from "../src/notifications/telegramWebhook.js"
import { defaultAppConfig } from "../src/setup/config.js"
import type { AppConfig } from "../src/setup/types.js"

let messageSeq = 0

function projected(event: Record<string, unknown>) {
  messageSeq += 1
  return projectWorkflowEvent(event as never, { id: `msg-${messageSeq}`, ts: messageSeq })
}

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-telegram-refactor-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function seedOpenPrompt(repos: Repos, prompt: string) {
  const ws = repos.upsertWorkspace({ key: "t", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
  const pending = repos.createPendingPrompt({ runId: run.id, stageRunId: stageRun.id, prompt })
  repos.appendLog({
    runId: run.id,
    stageRunId: stageRun.id,
    eventType: "prompt_requested",
    message: prompt,
    data: { promptId: pending.id },
  })
  return { run, pending }
}

function inboundTelegramConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...defaultAppConfig(),
    publicBaseUrl: "http://100.64.0.7:3100",
    notifications: {
      telegram: {
        enabled: true,
        botTokenEnv: "TELEGRAM_BOT_TOKEN",
        defaultChatId: "9001",
        inbound: {
          enabled: true,
          webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET",
        },
      },
    },
    ...overrides,
  }
}

function fakeRequest(input: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}): IncomingMessage {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  req.method = input.method ?? "POST"
  req.url = "/webhooks/telegram"
  req.headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  )
  const payload = input.body === undefined ? "" : JSON.stringify(input.body)
  const chunks: Buffer[] = payload ? [Buffer.from(payload, "utf8")] : []
  const source = Readable.from(chunks)
  source.on("data", chunk => req.push(chunk))
  source.on("end", () => req.push(null))
  return req
}

function captureResponse(): { res: ServerResponse; status(): number; body(): string } {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  const res = new ServerResponse(req)
  let finalStatus = 0
  let finalBody = ""
  const originalWriteHead = res.writeHead.bind(res)
  res.writeHead = ((code: number, ...rest: unknown[]) => {
    finalStatus = code
    return originalWriteHead(code, ...(rest as []))
  }) as typeof res.writeHead
  const originalEnd = res.end.bind(res)
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") finalBody = chunk
    else if (chunk && Buffer.isBuffer(chunk)) finalBody = chunk.toString("utf8")
    return originalEnd(chunk as never, ...(rest as []))
  }) as typeof res.end
  return {
    res,
    status: () => finalStatus,
    body: () => finalBody,
  }
}

test("dispatcher appends openPrompt.text to run_blocked messages and persists telegram_message_id", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  const { run, pending } = seedOpenPrompt(repos, "Which branch should we resume from?")

  const sent: Array<{ text: string }> = []
  const dispatcher = new TelegramNotificationDispatcher(
    inboundTelegramConfig(),
    repos,
    {
      async send(input) {
        sent.push(input)
        return { ok: true, status: 200, messageId: 7777 }
      },
    },
  )

  const result = await dispatcher.deliver(projected({
    type: "run_blocked",
    runId: run.id,
    itemId: run.item_id,
    title: "Fix login",
    scope: { type: "stage", runId: run.id, stageId: "requirements" },
    cause: "stage_error",
    summary: "LLM could not decide the target branch",
  }))

  assert.equal(result.delivered, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /Question: Which branch should we resume from\?/)
  assert.match(sent[0].text, /Reply to answer/)

  const delivery = repos.getNotificationDelivery(`${run.id}:run_blocked:stage:requirements`)
  assert.equal(delivery?.status, "delivered")
  assert.equal(delivery?.telegram_message_id, 7777)
  assert.equal(delivery?.run_id, run.id)
  assert.equal(delivery?.prompt_id, pending.id)

  delete process.env.TELEGRAM_BOT_TOKEN
  db.close()
})

test("dispatcher rate-limits prompt_requested inside the minimum gap and re-notifies after it expires", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  const { run, pending } = seedOpenPrompt(repos, "What is the fix?")

  const sent: Array<{ text: string }> = []
  const dispatcher = new TelegramNotificationDispatcher(
    inboundTelegramConfig(),
    repos,
    {
      async send(input) {
        sent.push(input)
        return { ok: true, status: 200, messageId: sent.length }
      },
    },
  )

  const first = await dispatcher.deliver(projected({
    type: "prompt_requested",
    runId: run.id,
    promptId: pending.id,
    prompt: "What is the fix?",
  }))
  const second = await dispatcher.deliver(projected({
    type: "prompt_requested",
    runId: run.id,
    promptId: pending.id,
    prompt: "What is the fix?",
  }))

  assert.equal(first.delivered, true)
  assert.equal(second.delivered, false)
  assert.equal(sent.length, 1)

  // Force the dedup row to expire and re-try.
  const expiredTimestamp = Date.now() - 1
  const countBefore = repos.listNotificationDeliveries().length
  // Manually expire: claimNotificationDelivery accepts expiresAt in the past
  // and the WHERE clause allows re-claim when expires_at <= now.
  repos["db"].prepare(
    "UPDATE notification_deliveries SET expires_at = ? WHERE dedup_key = ?",
  ).run(expiredTimestamp, `${run.id}:prompt_requested:${pending.id}`)

  const third = await dispatcher.deliver(projected({
    type: "prompt_requested",
    runId: run.id,
    promptId: pending.id,
    prompt: "What is the fix?",
  }))
  assert.equal(third.delivered, true)
  assert.equal(sent.length, 2)
  assert.equal(repos.listNotificationDeliveries().length, countBefore)

  delete process.env.TELEGRAM_BOT_TOKEN
  db.close()
})

test("webhook rejects requests whose secret_token header does not match", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-horse"
  resetTelegramWebhookRateLimit()

  const req = fakeRequest({
    headers: { "x-telegram-bot-api-secret-token": "wrong" },
    body: { message: { message_id: 1, chat: { id: 9001 }, text: "hi" } },
  })
  const { res, status } = captureResponse()

  await handleTelegramWebhook(repos, inboundTelegramConfig(), req, res)
  assert.equal(status(), 401)

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  db.close()
})

test("webhook reply maps to recordAnswer and reacts with 👍", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-horse"
  resetTelegramWebhookRateLimit()

  const { run, pending } = seedOpenPrompt(repos, "Which branch?")
  // Simulate a prior outbound delivery that remembered its Telegram message id.
  repos.claimNotificationDelivery({
    dedupKey: `${run.id}:run_blocked:stage:requirements`,
    channel: "telegram",
    chatId: "9001",
    runId: run.id,
    promptId: pending.id,
  })
  repos.completeNotificationDelivery(`${run.id}:run_blocked:stage:requirements`, {
    status: "delivered",
    telegramMessageId: 4242,
  })

  const reactions: Array<{ messageId: number }> = []
  const req = fakeRequest({
    headers: { "x-telegram-bot-api-secret-token": "correct-horse" },
    body: {
      message: {
        message_id: 4243,
        chat: { id: 9001 },
        from: { username: "op" },
        text: "use main",
        reply_to_message: { message_id: 4242 },
      },
    },
  })
  const { res, status } = captureResponse()

  await handleTelegramWebhook(repos, inboundTelegramConfig(), req, res, {
    async react(input) {
      reactions.push({ messageId: input.messageId })
    },
    async send() {
      throw new Error("should not send a reply on success")
    },
  })

  assert.equal(status(), 200)
  const conversationPrompt = repos.getPendingPrompt(pending.id)
  assert.equal(conversationPrompt?.answer, "use main")
  assert.ok(conversationPrompt?.answered_at)
  assert.deepEqual(reactions, [{ messageId: 4243 }])

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  db.close()
})

test("webhook replies with help text when the reply_to message is unknown", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-horse"
  resetTelegramWebhookRateLimit()

  const softReplies: string[] = []
  const req = fakeRequest({
    headers: { "x-telegram-bot-api-secret-token": "correct-horse" },
    body: {
      message: {
        message_id: 10,
        chat: { id: 9001 },
        text: "random chatter",
        reply_to_message: { message_id: 99999 },
      },
    },
  })
  const { res, status } = captureResponse()

  await handleTelegramWebhook(repos, inboundTelegramConfig(), req, res, {
    async send(input) {
      softReplies.push(input.text)
      return { ok: true, status: 200 }
    },
    async react() {
      throw new Error("no reaction expected when no prompt is resolved")
    },
  })

  assert.equal(status(), 200)
  assert.equal(softReplies.length, 1)
  assert.match(softReplies[0], /Reply to a BeerEngineer prompt/)

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  db.close()
})

test("webhook ignores command-style messages in Phase B", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-horse"
  resetTelegramWebhookRateLimit()

  const softReplies: string[] = []
  const req = fakeRequest({
    headers: { "x-telegram-bot-api-secret-token": "correct-horse" },
    body: {
      message: { message_id: 1, chat: { id: 9001 }, text: "/resume" },
    },
  })
  const { res, status } = captureResponse()

  await handleTelegramWebhook(repos, inboundTelegramConfig(), req, res, {
    async send(input) {
      softReplies.push(input.text)
      return { ok: true, status: 200 }
    },
  })

  assert.equal(status(), 200)
  assert.match(softReplies[0] ?? "", /Commands are not supported/)

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  db.close()
})

test("webhook returns 404 when inbound is disabled in config", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "bot-secret"
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-horse"
  resetTelegramWebhookRateLimit()

  const configWithInboundOff: AppConfig = {
    ...defaultAppConfig(),
    publicBaseUrl: "http://100.64.0.7:3100",
    notifications: {
      telegram: {
        enabled: true,
        botTokenEnv: "TELEGRAM_BOT_TOKEN",
        defaultChatId: "9001",
        inbound: { enabled: false },
      },
    },
  }

  const req = fakeRequest({
    headers: { "x-telegram-bot-api-secret-token": "correct-horse" },
    body: { message: { message_id: 1, chat: { id: 9001 }, text: "hi" } },
  })
  const { res, status } = captureResponse()

  await handleTelegramWebhook(repos, configWithInboundOff, req, res)
  assert.equal(status(), 404)

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  db.close()
})

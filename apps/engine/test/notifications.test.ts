import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { createBus } from "../src/core/bus.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { attachTelegramNotifications } from "../src/notifications/index.js"
import { createExternalLinkBuilder } from "../src/notifications/links.js"
import { TelegramNotificationDispatcher } from "../src/notifications/dispatcher.js"
import { sanitizeTelegramText, sendTelegramMessage } from "../src/notifications/telegram.js"
import { defaultAppConfig, readConfigFile, writeConfigFile } from "../src/setup/config.js"
import { generateSetupReport } from "../src/setup/doctor.js"

test("config round-trips publicBaseUrl and telegram settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-notify-config-"))
  const path = join(dir, "config.json")
  const config = {
    ...defaultAppConfig(),
    publicBaseUrl: "http://100.64.0.7:3100/",
    notifications: {
      telegram: {
        enabled: true,
        botTokenEnv: "TELEGRAM_BOT_TOKEN",
        defaultChatId: "123456",
      },
    },
  }

  writeConfigFile(path, config)
  const raw = JSON.parse(readFileSync(path, "utf8")) as { publicBaseUrl: string }
  assert.equal(raw.publicBaseUrl, "http://100.64.0.7:3100/")

  const state = readConfigFile(path)
  assert.equal(state.kind, "ok")
  if (state.kind !== "ok") return
  assert.equal(state.config.publicBaseUrl, "http://100.64.0.7:3100")
  assert.equal(state.config.notifications?.telegram?.enabled, true)
  assert.equal(state.config.notifications?.telegram?.botTokenEnv, "TELEGRAM_BOT_TOKEN")
  assert.equal(state.config.notifications?.telegram?.defaultChatId, "123456")
})

test("link builder normalizes trailing slash and rejects loopback", () => {
  const links = createExternalLinkBuilder("http://100.64.0.7:3100/")
  assert.equal(links.publicBaseUrl, "http://100.64.0.7:3100")
  assert.equal(links.run("run-1"), "http://100.64.0.7:3100/runs/run-1")
  assert.throws(() => createExternalLinkBuilder("http://localhost:3100"), /loopback/)
  assert.throws(() => createExternalLinkBuilder("http://demo.local:3100"), /loopback/)
})

test("telegram text sanitation truncates and redacts secrets", () => {
  const text = sanitizeTelegramText(
    `token sk-abcdefghijklmnopqrstuvwxyz012345 message ghp_12345678901234567890 and xoxb-a-secret-value and BOT`,
    ["BOT"],
  )
  assert.match(text, /\[redacted\]/)
  assert.doesNotMatch(text, /sk-abcdefghijklmnopqrstuvwxyz012345/)
  assert.doesNotMatch(text, /ghp_12345678901234567890/)
  assert.doesNotMatch(text, /xoxb-a-secret-value/)
  assert.doesNotMatch(text, /BOT/)
})

test("telegram client honors one retry-after on HTTP 429", async () => {
  const calls: Array<{ url: string; body: string }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body) })
    if (calls.length === 1) {
      return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
    }
    return new Response("ok", { status: 200 })
  }

  const result = await sendTelegramMessage(
    { token: "secret-token", chatId: "123", text: "hello" },
    { fetchImpl, timeoutMs: 1000 },
  )

  assert.equal(result.ok, true)
  assert.equal(calls.length, 2)
})

test("dispatcher maps canonical events into telegram messages", async () => {
  const sent: Array<{ token: string; chatId: string; text: string }> = []
  const dir = mkdtempSync(join(tmpdir(), "be2-notify-db-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "secret-token"

  const dispatcher = new TelegramNotificationDispatcher(
    {
      ...defaultAppConfig(),
      publicBaseUrl: "http://100.64.0.7:3100",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "123",
        },
      },
    },
    repos,
    {
      async send(input) {
        sent.push(input)
        return { ok: true, status: 200 }
      },
    },
  )

  const result = await dispatcher.deliver({
    type: "run_blocked",
    runId: "run-1",
    itemId: "item-1",
    title: "Fix login",
    scope: { type: "story", runId: "run-1", waveNumber: 2, storyId: "US-01" },
    cause: "story_error",
    summary: "Blocked on sk-abcdefghijklmnopqrstuvwxyz012345 in logs",
  })

  assert.deepEqual(result, { delivered: true, eventType: "run_blocked" })
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /BeerEngineer run blocked/)
  assert.match(sent[0].text, /Open: http:\/\/100.64.0.7:3100\/runs\/run-1/)
  assert.doesNotMatch(sent[0].text, /sk-abcdefghijklmnopqrstuvwxyz012345/)
  const delivery = repos.getNotificationDelivery("run-1:run_blocked:story:2:US-01")
  assert.equal(delivery?.status, "delivered")
  assert.equal(delivery?.attempt_count, 1)

  delete process.env.TELEGRAM_BOT_TOKEN
  db.close()
})

test("dispatcher maps stage_completed into telegram messages", async () => {
  const sent: Array<{ token: string; chatId: string; text: string }> = []
  const dir = mkdtempSync(join(tmpdir(), "be2-notify-db-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "secret-token"

  const dispatcher = new TelegramNotificationDispatcher(
    {
      ...defaultAppConfig(),
      publicBaseUrl: "http://100.64.0.7:3100",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "123",
        },
      },
    },
    repos,
    {
      async send(input) {
        sent.push(input)
        return { ok: true, status: 200 }
      },
    },
  )

  const result = await dispatcher.deliver({
    type: "stage_completed",
    runId: "run-1",
    stageRunId: "stage-1",
    stageKey: "requirements",
    status: "completed",
  })

  assert.deepEqual(result, { delivered: true, eventType: "stage_completed" })
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /BeerEngineer stage completed/)
  assert.match(sent[0].text, /Stage: requirements/)

  delete process.env.TELEGRAM_BOT_TOKEN
  db.close()
})

test("dispatcher skips duplicate canonical events after the first durable claim", async () => {
  const sent: Array<{ token: string; chatId: string; text: string }> = []
  const dir = mkdtempSync(join(tmpdir(), "be2-notify-db-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  process.env.TELEGRAM_BOT_TOKEN = "secret-token"

  const dispatcher = new TelegramNotificationDispatcher(
    {
      ...defaultAppConfig(),
      publicBaseUrl: "http://100.64.0.7:3100",
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "123",
        },
      },
    },
    repos,
    {
      async send(input) {
        sent.push(input)
        return { ok: true, status: 200 }
      },
    },
  )

  const event = {
    type: "run_finished" as const,
    runId: "run-1",
    itemId: "item-1",
    title: "Fix login",
    status: "completed" as const,
  }
  const first = await dispatcher.deliver(event)
  const second = await dispatcher.deliver(event)

  assert.deepEqual(first, { delivered: true, eventType: "run_finished" })
  assert.equal(second.delivered, false)
  assert.match(second.reason, /duplicate notification skipped/)
  assert.equal(sent.length, 1)
  assert.equal(repos.getNotificationDelivery("run-1:run_finished")?.attempt_count, 1)

  delete process.env.TELEGRAM_BOT_TOKEN
  db.close()
})

test("subscriber is not attached when telegram is disabled", () => {
  const bus = createBus()
  const dir = mkdtempSync(join(tmpdir(), "be2-notify-db-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const detach = attachTelegramNotifications(bus, new Repos(db), defaultAppConfig())
  assert.equal(detach, null)
  db.close()
})

test("setup report is blocked when telegram is enabled but required fields are missing", async () => {
  const report = await generateSetupReport({
    overrides: {
      telegramEnabled: true,
    },
  })

  assert.equal(report.overall, "blocked")
  const group = report.groups.find(entry => entry.id === "notifications")
  assert.ok(group)
  assert.equal(group?.satisfied, false)
  assert.equal(group?.checks.find(check => check.id === "notifications.telegram.default-chat-id")?.status, "missing")
})

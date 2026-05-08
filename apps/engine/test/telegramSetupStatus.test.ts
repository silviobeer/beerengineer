import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { buildWorkspaceConfigFile, writeWorkspaceConfig } from "../src/core/workspaces/configFile.js"
import { getAppConfigView } from "../src/setup/appConfigView.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"

const TEST_API_TOKEN = "test-token"

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-telegram-setup-"))
  return {
    dir,
    dbPath: join(dir, "server.sqlite"),
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

function withClearedSetupEnv<T>(run: () => T): T {
  const keys = [
    "BEERENGINEER_PUBLIC_BASE_URL",
    "BEERENGINEER_TELEGRAM_ENABLED",
    "BEERENGINEER_TELEGRAM_BOT_TOKEN_ENV",
    "BEERENGINEER_TELEGRAM_DEFAULT_CHAT_ID",
    "BEERENGINEER_TELEGRAM_LEVEL",
    "BEERENGINEER_TELEGRAM_INBOUND_ENABLED",
    "BEERENGINEER_TELEGRAM_WEBHOOK_SECRET_ENV",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TEAM_TELEGRAM_TOKEN",
    "TEAM_TELEGRAM_SECRET",
  ] as const
  const previous = new Map<string, string | undefined>()
  for (const key of keys) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }
  try {
    return run()
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4800 + Math.floor(Math.random() * 400)
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

test("REQ-1 default and workspace Telegram setup resolve provenance, inheritance, isolation, and blockers", async () => {
  const paths = tempPaths()
  const db = initDatabase(paths.dbPath)
  const repos = new Repos(db)

  try {
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
    process.env.TELEGRAM_BOT_TOKEN = "telegram-bot-secret-value"
    process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-webhook-secret-value"

    const alphaRoot = join(paths.dir, "alpha")
    const betaRoot = join(paths.dir, "beta")
    mkdirSync(alphaRoot, { recursive: true })
    mkdirSync(betaRoot, { recursive: true })
    repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: alphaRoot })
    repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: betaRoot })
    await writeWorkspaceConfig(alphaRoot, buildWorkspaceConfigFile({
      key: "alpha",
      name: "Alpha",
      harnessProfile: { mode: "fast" },
      sonar: { enabled: false },
      telegram: {
        defaultChatId: "9001",
        publicBaseUrl: "https://alpha.example.test",
      },
    }))

    const appView = withClearedSetupEnv(() => {
      process.env.TELEGRAM_BOT_TOKEN = "telegram-bot-secret-value"
      process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-webhook-secret-value"
      return getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir }, { repos })
    })
    assert.equal(appView.telegramInbound?.readiness.state, "ready")
    assert.deepEqual(appView.telegramInbound?.readiness.blockers, [])
    assert.equal(appView.telegramInbound?.fields.bot.source, "app-default")
    assert.equal(appView.telegramInbound?.fields.chat.source, "app-default")
    assert.equal(appView.telegramInbound?.fields.webhookSecret.source, "app-default")
    assert.equal(appView.telegramInbound?.fields.publicWebhook.source, "app-default")

    const alphaView = withClearedSetupEnv(() => {
      process.env.TELEGRAM_BOT_TOKEN = "telegram-bot-secret-value"
      process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-webhook-secret-value"
      return getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir }, { repos, workspaceKey: "alpha" })
    })
    assert.equal(alphaView.telegramInbound?.scope.kind, "workspace")
    assert.equal(alphaView.telegramInbound?.scope.kind === "workspace" && alphaView.telegramInbound.scope.inheritance, "mixed")
    assert.equal(alphaView.telegramInbound?.fields.bot.source, "app-default")
    assert.equal(alphaView.telegramInbound?.fields.chat.source, "workspace-override")
    assert.equal(alphaView.telegramInbound?.fields.publicWebhook.source, "workspace-override")
    assert.equal(alphaView.telegramInbound?.fields.webhookSecret.source, "app-default")
    assert.equal(alphaView.telegramInbound?.fields.chat.chatId, "9001")
    assert.equal(alphaView.telegramInbound?.fields.publicWebhook.webhookUrl, "https://alpha.example.test/webhooks/telegram")

    const betaView = withClearedSetupEnv(() => {
      process.env.TELEGRAM_BOT_TOKEN = "telegram-bot-secret-value"
      process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-webhook-secret-value"
      return getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir }, { repos, workspaceKey: "beta" })
    })
    assert.equal(betaView.telegramInbound?.scope.kind, "workspace")
    assert.equal(betaView.telegramInbound?.scope.kind === "workspace" && betaView.telegramInbound.scope.inheritance, "inherited")
    assert.equal(betaView.telegramInbound?.fields.chat.chatId, "10001")
    assert.equal(betaView.telegramInbound?.fields.publicWebhook.webhookUrl, "https://operator.example.test/webhooks/telegram")

    const blockedConfigPath = join(paths.dir, "blocked-config.json")
    writeConfigFile(blockedConfigPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
    })
    const gammaRoot = join(paths.dir, "gamma")
    mkdirSync(gammaRoot, { recursive: true })
    repos.upsertWorkspace({ key: "gamma", name: "Gamma", rootPath: gammaRoot })
    await writeWorkspaceConfig(gammaRoot, buildWorkspaceConfigFile({
      key: "gamma",
      name: "Gamma",
      harnessProfile: { mode: "fast" },
      sonar: { enabled: false },
      telegram: {
        publicBaseUrl: "http://localhost:3100",
      },
    }))
    const gammaView = withClearedSetupEnv(() =>
      getAppConfigView({ configPath: blockedConfigPath, dataDir: paths.dataDir }, { repos, workspaceKey: "gamma" }),
    )
    assert.equal(gammaView.telegramInbound?.readiness.state, "blocked")
    assert.match(gammaView.telegramInbound?.readiness.blockers.join("\n") ?? "", /bot token env var/)
    assert.match(gammaView.telegramInbound?.readiness.blockers.join("\n") ?? "", /default chat id/)
    assert.match(gammaView.telegramInbound?.readiness.blockers.join("\n") ?? "", /inbound replies are disabled/i)
    assert.match(gammaView.telegramInbound?.readiness.blockers.join("\n") ?? "", /webhook secret presence is not configured/i)
    assert.match(gammaView.telegramInbound?.readiness.blockers.join("\n") ?? "", /public webhook configuration is invalid/i)
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("REQ-1 setup config API redacts raw Telegram secrets for app and workspace scope", async () => {
  const paths = tempPaths()
  initDatabase(paths.dbPath).close()
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(join(paths.dir, "alpha"), { recursive: true })
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

  const db = initDatabase(paths.dbPath)
  const repos = new Repos(db)
  try {
    repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: join(paths.dir, "alpha") })
    await writeWorkspaceConfig(join(paths.dir, "alpha"), buildWorkspaceConfigFile({
      key: "alpha",
      name: "Alpha",
      harnessProfile: { mode: "fast" },
      sonar: { enabled: false },
      telegram: {
        botTokenEnv: "TEAM_TELEGRAM_TOKEN",
        inbound: { webhookSecretEnv: "TEAM_TELEGRAM_SECRET" },
      },
    }))
    const { proc, base } = startServer({
      BEERENGINEER_UI_DB_PATH: paths.dbPath,
      BEERENGINEER_CONFIG_PATH: paths.configPath,
      BEERENGINEER_DATA_DIR: paths.dataDir,
      TELEGRAM_BOT_TOKEN: "telegram-bot-secret-value",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret-value",
      TEAM_TELEGRAM_TOKEN: "team-telegram-bot-secret-value",
      TEAM_TELEGRAM_SECRET: "team-telegram-webhook-secret-value",
    })
    try {
      await waitForHealth(base)
      const appRes = await fetch(`${base}/setup/config`)
      const appBody = await appRes.text()
      assert.equal(appRes.status, 200)
      assert.doesNotMatch(appBody, /telegram-bot-secret-value/)
      assert.doesNotMatch(appBody, /telegram-webhook-secret-value/)

      const workspaceRes = await fetch(`${base}/setup/config?workspaceKey=alpha`)
      const workspaceBody = await workspaceRes.text()
      assert.equal(workspaceRes.status, 200)
      assert.match(workspaceBody, /workspace-override/)
      assert.doesNotMatch(workspaceBody, /team-telegram-bot-secret-value/)
      assert.doesNotMatch(workspaceBody, /team-telegram-webhook-secret-value/)
    } finally {
      await stopServer(proc)
    }
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

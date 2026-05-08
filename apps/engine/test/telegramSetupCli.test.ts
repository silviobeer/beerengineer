import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { buildWorkspaceConfigFile, writeWorkspaceConfig } from "../src/core/workspaces/configFile.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"

test("REQ-1 CLI setup telegram output preserves scope semantics and redacts secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-telegram-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const configPath = join(dir, "config.json")
  const dataDir = join(dir, "data")
  const dbPath = join(dir, "server.sqlite")
  const alphaRoot = join(dir, "alpha")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(alphaRoot, { recursive: true })
    writeConfigFile(configPath, {
      ...defaultAppConfig(),
      dataDir,
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
    repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: alphaRoot })
    await writeWorkspaceConfig(alphaRoot, buildWorkspaceConfigFile({
      key: "alpha",
      name: "Alpha",
      harnessProfile: { mode: "fast" },
      sonar: { enabled: false },
      telegram: {
        defaultChatId: "9001",
      },
    }))

    const env = {
      ...process.env,
      BEERENGINEER_UI_DB_PATH: dbPath,
      BEERENGINEER_CONFIG_PATH: configPath,
      BEERENGINEER_DATA_DIR: dataDir,
      TELEGRAM_BOT_TOKEN: "telegram-bot-secret-value",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret-value",
    }
    const appScope = spawnSync(process.execPath, [binPath, "setup", "telegram"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })
    const workspaceScope = spawnSync(process.execPath, [binPath, "setup", "telegram", "--workspace", "alpha"], {
      cwd: engineRoot,
      encoding: "utf8",
      env,
    })

    assert.equal(appScope.status, 0, `${appScope.stdout}\n${appScope.stderr}`)
    assert.equal(workspaceScope.status, 0, `${workspaceScope.stdout}\n${workspaceScope.stderr}`)
    assert.match(appScope.stdout, /Telegram inbound replies: ready/)
    assert.match(appScope.stdout, /source=app-default/)
    assert.match(workspaceScope.stdout, /Workspace alpha mixes app-level defaults/i)
    assert.match(workspaceScope.stdout, /source=workspace-override/)
    assert.doesNotMatch(appScope.stdout, /telegram-bot-secret-value/)
    assert.doesNotMatch(appScope.stdout, /telegram-webhook-secret-value/)
    assert.doesNotMatch(workspaceScope.stdout, /telegram-bot-secret-value/)
    assert.doesNotMatch(workspaceScope.stdout, /telegram-webhook-secret-value/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

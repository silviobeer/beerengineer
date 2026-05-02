import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { getAppConfigView } from "../src/setup/appConfigView.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"
import { storeSecret } from "../src/setup/secretStore.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-app-config-view-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

test("AC-9 effective app config exposes app-wide editable fields", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      allowedRoots: ["/tmp/demo-root"],
      enginePort: 4999,
      publicBaseUrl: "https://example.test",
      llm: {
        ...defaultAppConfig().llm,
        provider: "openai",
        model: "gpt-test",
        apiKeyRef: "OPENAI_API_KEY",
      },
      vcs: { github: { enabled: true } },
      browser: { enabled: true },
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
          defaultChatId: "12345",
          level: 1,
          inbound: { enabled: true, webhookSecretEnv: "TELEGRAM_WEBHOOK_SECRET" },
        },
      },
    })

    const view = getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir })

    assert.equal(view.config.allowedRoots[0], "/tmp/demo-root")
    assert.equal(view.config.enginePort, 4999)
    assert.equal(view.config.publicBaseUrl, "https://example.test")
    assert.equal(view.config.llm.provider, "openai")
    assert.equal(view.config.llm.model, "gpt-test")
    assert.deepEqual(view.config.llm.defaultHarnessProfile, defaultAppConfig().llm.defaultHarnessProfile)
    assert.equal(view.config.vcs.github.enabled, true)
    assert.equal(view.config.browser.enabled, true)
    assert.equal(view.config.notifications.telegram.enabled, true)
    assert.equal(view.config.notifications.telegram.level, 1)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-10 effective app config returns secret references, never plaintext values", () => {
  const paths = tempSetupPaths()
  try {
    process.env.OPENAI_API_KEY = "sk-secret-plaintext"
    process.env.TELEGRAM_BOT_TOKEN = "telegram-secret-plaintext"
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      llm: {
        ...defaultAppConfig().llm,
        provider: "openai",
        apiKeyRef: "OPENAI_API_KEY",
      },
      notifications: {
        telegram: {
          enabled: true,
          botTokenEnv: "TELEGRAM_BOT_TOKEN",
        },
      },
    })

    const view = getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir })
    const serialized = JSON.stringify(view)

    assert.equal(view.config.llm.apiKey.ref, "OPENAI_API_KEY")
    assert.equal(view.config.llm.apiKey.present, true)
    assert.equal(view.config.notifications.telegram.botToken?.ref, "TELEGRAM_BOT_TOKEN")
    assert.equal(view.config.notifications.telegram.botToken?.present, true)
    assert.doesNotMatch(serialized, /sk-secret-plaintext/)
    assert.doesNotMatch(serialized, /telegram-secret-plaintext/)
  } finally {
    delete process.env.OPENAI_API_KEY
    delete process.env.TELEGRAM_BOT_TOKEN
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-10 effective app config treats stored secrets as present without env export", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      llm: {
        ...defaultAppConfig().llm,
        apiKeyRef: "ANTHROPIC_API_KEY",
      },
    })
    storeSecret("ANTHROPIC_API_KEY", "stored-secret-plaintext", {
      storePath: join(paths.dir, "secrets.json"),
    })
    process.env.BEERENGINEER_SECRET_STORE_PATH = join(paths.dir, "secrets.json")

    const view = getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir })
    const serialized = JSON.stringify(view)

    assert.equal(view.config.llm.apiKey.present, true)
    assert.doesNotMatch(serialized, /stored-secret-plaintext/)
  } finally {
    delete process.env.BEERENGINEER_SECRET_STORE_PATH
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-11 effective app config excludes workspace and project settings", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const view = getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir })
    const serialized = JSON.stringify(view)

    assert.doesNotMatch(serialized, /workspace/i)
    assert.equal("workspace" in view.config, false)
    assert.equal("project" in view.config, false)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-12 effective app config exposes uninitialized, partial, and complete setup states", () => {
  const uninitialized = tempSetupPaths()
  const invalid = tempSetupPaths()
  const complete = tempSetupPaths()
  try {
    assert.equal(getAppConfigView({
      configPath: uninitialized.configPath,
      dataDir: uninitialized.dataDir,
    }).setupState, "uninitialized")

    writeFileSync(invalid.configPath, "{ invalid json", "utf8")
    assert.equal(getAppConfigView({
      configPath: invalid.configPath,
      dataDir: invalid.dataDir,
    }).setupState, "partial")

    writeConfigFile(complete.configPath, { ...defaultAppConfig(), dataDir: complete.dataDir })
    assert.equal(getAppConfigView({
      configPath: complete.configPath,
      dataDir: complete.dataDir,
    }).setupState, "complete")
  } finally {
    rmSync(uninitialized.dir, { recursive: true, force: true })
    rmSync(invalid.dir, { recursive: true, force: true })
    rmSync(complete.dir, { recursive: true, force: true })
  }
})

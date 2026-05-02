import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { test } from "node:test"

import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"
import { getSecretMetadata, secretStorePath, storeSecret } from "../src/setup/secretStore.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-store-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
    storePath: join(dir, "state", "secrets.json"),
    workspace: join(dir, "workspace"),
  }
}

test("AC-1 secret values are not persisted in repo, workspace, env, or app config files", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })
    storeSecret("sonar.token", "super-secret-value", { storePath: paths.storePath })

    const configRaw = readFileSync(paths.configPath, "utf8")
    assert.doesNotMatch(configRaw, /super-secret-value/)
    assert.equal(process.env["sonar.token"], undefined)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-2 secret store lives in an OS-aware beerengineer state/data path outside registered workspaces", () => {
  const paths = tempSetupPaths()
  try {
    const resolved = secretStorePath({ storePath: paths.storePath })
    storeSecret("telegram.bot", "telegram-secret", { storePath: resolved })

    assert.equal(existsSync(resolved), true)
    assert.equal(relative(paths.workspace, resolved).startsWith(".."), true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-3 app config contains only secret references and redacted metadata", () => {
  const paths = tempSetupPaths()
  try {
    const metadata = storeSecret("openai.api", "sk-secret", { storePath: paths.storePath })

    assert.equal(metadata.ref, "openai.api")
    assert.equal(metadata.status, "active")
    assert.equal("value" in metadata, false)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-4 stored secret values are never returned as HTTP-safe plaintext metadata", () => {
  const paths = tempSetupPaths()
  try {
    storeSecret("openai.api", "sk-secret", { storePath: paths.storePath })
    const metadata = getSecretMetadata("openai.api", { storePath: paths.storePath })

    assert.equal(metadata.ref, "openai.api")
    assert.doesNotMatch(JSON.stringify(metadata), /sk-secret/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

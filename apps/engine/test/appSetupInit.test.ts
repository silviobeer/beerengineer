import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { initializeAppState } from "../src/setup/appState.js"
import { defaultAppConfig, readConfigFile, resolveConfiguredDbPath, writeConfigFile } from "../src/setup/config.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-app-init-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

test("AC-5 initialization creates config, data directory, and SQLite state when missing", () => {
  const paths = tempSetupPaths()
  try {
    const result = initializeAppState({
      configPath: paths.configPath,
      dataDir: paths.dataDir,
    })

    assert.equal(result.ok, true)
    assert.equal(result.configState, "created")
    assert.equal(result.dataDirState, "created")
    assert.equal(result.databaseState, "created")
    assert.equal(existsSync(paths.configPath), true)
    assert.equal(existsSync(paths.dataDir), true)
    assert.equal(existsSync(resolveConfiguredDbPath(result.config)), true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-6 initialization preserves existing valid config values", () => {
  const paths = tempSetupPaths()
  try {
    const existing = {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      allowedRoots: ["/tmp/demo-root"],
      enginePort: 4999,
      llm: {
        ...defaultAppConfig().llm,
        provider: "openai" as const,
        model: "gpt-test",
        apiKeyRef: "OPENAI_API_KEY",
      },
    }
    writeConfigFile(paths.configPath, existing)
    const before = readFileSync(paths.configPath, "utf8")

    const result = initializeAppState({
      configPath: paths.configPath,
      dataDir: paths.dataDir,
    })

    assert.equal(result.ok, true)
    assert.equal(result.configState, "unchanged")
    assert.equal(readFileSync(paths.configPath, "utf8"), before)
    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    if (state.kind === "ok") {
      assert.deepEqual(state.config.allowedRoots, ["/tmp/demo-root"])
      assert.equal(state.config.enginePort, 4999)
      assert.equal(state.config.llm.provider, "openai")
    }
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-7 initialization reports invalid existing config without overwriting it", () => {
  const paths = tempSetupPaths()
  try {
    writeFileSync(paths.configPath, "{ invalid json", "utf8")

    const result = initializeAppState({
      configPath: paths.configPath,
      dataDir: paths.dataDir,
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, "invalid_config")
    assert.match(result.error, /Expected property name|JSON/)
    assert.equal(readFileSync(paths.configPath, "utf8"), "{ invalid json")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

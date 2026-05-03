import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { patchAppConfig } from "../src/setup/appConfigPatch.js"
import { defaultAppConfig, readConfigFile, writeConfigFile } from "../src/setup/config.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-app-config-patch-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
  }
}

test("AC-13 partial-save responses list saved and rejected fields separately", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const result = patchAppConfig({
      configPath: paths.configPath,
      dataDir: paths.dataDir,
    }, {
      allowedRoots: ["/tmp/beerengineer-demo"],
      enginePort: -1,
      browser: { enabled: true },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(result.saved.sort(), ["allowedRoots", "browser.enabled"].sort())
    assert.deepEqual(result.rejected.map(entry => entry.field), ["enginePort"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-13 partial-save rejects empty allowedRoots instead of persisting it", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, { allowedRoots: [] })

    assert.equal(result.ok, false)
    assert.deepEqual(result.saved, [])
    assert.deepEqual(result.rejected.map(entry => entry.field), ["allowedRoots"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-13 partial-save rejects filesystem root and traversal allowedRoots", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, { allowedRoots: ["/", "../workspace"] })

    assert.equal(result.ok, false)
    assert.deepEqual(result.saved, [])
    assert.deepEqual(result.rejected.map(entry => entry.field), ["allowedRoots"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-13 partial-save refuses to create config before setup init", () => {
  const paths = tempSetupPaths()
  try {
    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, { browser: { enabled: true } })

    assert.equal(result.ok, false)
    assert.deepEqual(result.saved, [])
    assert.deepEqual(result.rejected, [{ field: "config", error: "setup_config_missing" }])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-14 invalid fields remain unchanged in persisted config", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir, enginePort: 4100 })

    patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      enginePort: "not-a-port",
      publicBaseUrl: "https://operator.example",
    })

    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    if (state.kind === "ok") {
      assert.equal(state.config.enginePort, 4100)
      assert.equal(state.config.publicBaseUrl, "https://operator.example")
    }
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-15 enginePort is stored as a future-start value without changing current process PORT", () => {
  const paths = tempSetupPaths()
  const before = process.env.PORT
  try {
    process.env.PORT = "4100"
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir, enginePort: 4100 })

    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, { enginePort: 4999 })

    assert.deepEqual(result.saved, ["enginePort"])
    assert.equal(process.env.PORT, "4100")
    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    if (state.kind === "ok") assert.equal(state.config.enginePort, 4999)
  } finally {
    if (before === undefined) delete process.env.PORT
    else process.env.PORT = before
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-15 enginePort rejects values outside the TCP port range", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir, enginePort: 4100 })

    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, { enginePort: 2147483647 })

    assert.equal(result.ok, false)
    assert.deepEqual(result.rejected.map(entry => entry.field), ["enginePort"])
    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    if (state.kind === "ok") assert.equal(state.config.enginePort, 4100)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

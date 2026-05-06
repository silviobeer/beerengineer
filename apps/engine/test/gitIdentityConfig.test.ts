import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { getAppConfigView } from "../src/setup/appConfigView.js"
import { patchAppConfig } from "../src/setup/appConfigPatch.js"
import { defaultAppConfig, readConfigFile, writeConfigFile } from "../src/setup/config.js"
import { readGlobalGitReadiness } from "../src/setup/gitIdentity.js"

function tempSetupPaths() {
  const dir = mkdtempSync(join(tmpdir(), "be2-git-identity-config-"))
  return {
    dir,
    configPath: join(dir, "config.json"),
    dataDir: join(dir, "data"),
    globalGitConfig: join(dir, "global.gitconfig"),
  }
}

test("AC-10 app-level identity stores display name, email, and localOnly", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      gitIdentityDefault: { displayName: "Beer User", email: "beer@local.beerengineer" },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.config.gitIdentityDefault, {
      displayName: "Beer User",
      email: "beer@local.beerengineer",
      localOnly: true,
    })
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-11 saving app-level identity does not write global git config", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })

    const before = spawnSync("git", ["config", "--global", "--get", "user.email"], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig },
      encoding: "utf8",
    })
    assert.notEqual(before.status, 0)

    patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      gitIdentityDefault: { displayName: "Beer User", email: "beer@example.test" },
    })

    const after = spawnSync("git", ["config", "--global", "--get", "user.email"], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig },
      encoding: "utf8",
    })
    assert.notEqual(after.status, 0)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-12 saved app-level identity appears in global setup status and config view", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, {
      ...defaultAppConfig(),
      dataDir: paths.dataDir,
      gitIdentityDefault: {
        displayName: "Beer User",
        email: "beer@example.test",
        localOnly: false,
      },
    })

    const state = readConfigFile(paths.configPath)
    assert.equal(state.kind, "ok")
    assert.equal(getAppConfigView({ configPath: paths.configPath, dataDir: paths.dataDir }).config.gitIdentityDefault?.email, "beer@example.test")
    if (state.kind === "ok") {
      const readiness = readGlobalGitReadiness(state.config, { env: { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig } })
      assert.equal(readiness.appDefaultIdentity?.email, "beer@example.test")
    }
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-13 private placeholder emails set localOnly true", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })
    const result = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      gitIdentityDefault: { displayName: "Private User", email: "private@local.beerengineer" },
    })

    assert.equal(result.config.gitIdentityDefault?.localOnly, true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-14 real and GitHub noreply emails can be localOnly false", () => {
  const paths = tempSetupPaths()
  try {
    writeConfigFile(paths.configPath, { ...defaultAppConfig(), dataDir: paths.dataDir })
    const real = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      gitIdentityDefault: { displayName: "Real User", email: "real@example.com" },
    })
    const noreply = patchAppConfig({ configPath: paths.configPath, dataDir: paths.dataDir }, {
      gitIdentityDefault: { displayName: "Hub User", email: "123+hub@users.noreply.github.com" },
    })

    assert.equal(real.config.gitIdentityDefault?.localOnly, false)
    assert.equal(noreply.config.gitIdentityDefault?.localOnly, false)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

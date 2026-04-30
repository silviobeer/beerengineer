import { test } from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"

import {
  activateManagedInstallVersion,
  evaluateManagedInstallState,
  repairManagedInstallState,
  resolveManagedInstallStatePaths,
} from "../src/core/managedInstall/state.js"

test("activateManagedInstallVersion creates update-aligned layout current pointer and wrappers", () => {
  const config = configForTempDir()
  const result = activateManagedInstallVersion(config, releaseRef("v1.0.0"))
  const paths = resolveManagedInstallStatePaths(config)

  assert.equal(result.versionPath, join(config.dataDir, "install", "versions", "v1.0.0"))
  assert.equal(paths.versionsDir, join(config.dataDir, "install", "versions"))
  assert.equal(realpathSync(paths.currentLinkPath), result.versionPath)
  assert.equal(paths.wrapperPath, join(config.dataDir, "bin", "beerengineer"))
  assert.ok(lstatSync(paths.wrapperPath).isFile())
  assert.match(readFileSync(paths.wrapperPath, "utf8"), /install\/current\/apps\/engine\/bin\/beerengineer\.js/)

  const windowsPaths = resolveManagedInstallStatePaths(config, { platform: "win32" })
  assert.equal(windowsPaths.wrapperPath, join(config.dataDir, "bin", "beerengineer.cmd"))
  activateManagedInstallVersion(config, releaseRef("v2.0.0"), { platform: "win32" })
  assert.match(readFileSync(windowsPaths.wrapperPath, "utf8"), /install\\current\\apps\\engine\\bin\\beerengineer\.js/)
})

test("managed install adoption preserves existing config database and dev checkout artifacts", () => {
  const config = configForTempDir()
  const configPath = join(config.dataDir, "config.json")
  const dbPath = join(config.dataDir, "beerengineer.sqlite")
  const devCheckoutPackage = join(config.dataDir, "dev-checkout", "package.json")
  mkdirSync(join(config.dataDir, "dev-checkout"), { recursive: true })
  writeFileSync(configPath, "user config\n", "utf8")
  writeFileSync(dbPath, "sqlite data\n", "utf8")
  writeFileSync(devCheckoutPackage, "{}\n", "utf8")

  const before = evaluateManagedInstallState(config)
  assert.equal(before.status, "adoptable")
  assert.deepEqual(before.preservedAppData.configFiles, [configPath])
  assert.deepEqual(before.preservedAppData.sqliteFiles, [dbPath])

  createValidVersionTree(config.dataDir, "v1.0.0")
  activateManagedInstallVersion(config, releaseRef("v1.0.0"))

  assert.equal(readFileSync(configPath, "utf8"), "user config\n")
  assert.equal(readFileSync(dbPath, "utf8"), "sqlite data\n")
  assert.equal(readFileSync(devCheckoutPackage, "utf8"), "{}\n")
  assert.equal(existsSync(join(config.dataDir, "install", "dev-checkout")), false)
})

test("repairManagedInstallState repairs unambiguous missing current and wrapper states", () => {
  const config = configForTempDir()
  const versionDir = createValidVersionTree(config.dataDir, "v1.0.0")

  const repairedCurrent = repairManagedInstallState(config)
  assert.deepEqual(repairedCurrent.repairs.map(repair => repair.kind), ["created-current", "created-wrapper"])
  assert.equal(realpathSync(resolveManagedInstallStatePaths(config).currentLinkPath), versionDir)
  assert.equal(evaluateManagedInstallState(config).status, "already-installed")

  const paths = resolveManagedInstallStatePaths(config)
  rmSync(paths.wrapperPath, { force: true })
  const repairedWrapper = repairManagedInstallState(config)
  assert.deepEqual(repairedWrapper.repairs.map(repair => repair.kind), ["created-wrapper"])
  assert.equal(existsSync(paths.wrapperPath), true)

  const idempotent = repairManagedInstallState(config)
  assert.equal(idempotent.status, "already-installed")
  assert.deepEqual(idempotent.repairs, [])
})

test("evaluateManagedInstallState hard-stops ambiguous or invalid active states without overwriting", () => {
  const config = configForTempDir()
  createValidVersionTree(config.dataDir, "v1.0.0")
  createValidVersionTree(config.dataDir, "v1.1.0")

  const ambiguous = evaluateManagedInstallState(config)
  assert.equal(ambiguous.status, "hard-stop")
  assert.equal(ambiguous.stop?.code, "ambiguous_versions_without_current")
  assert.match(ambiguous.stop?.message ?? "", /install\/versions/)

  const paths = resolveManagedInstallStatePaths(config)
  const invalidCurrent = join(config.dataDir, "install", "broken-current")
  mkdirSync(invalidCurrent, { recursive: true })
  symlinkSync(invalidCurrent, paths.currentLinkPath, "dir")
  const currentBefore = realpathSync(paths.currentLinkPath)
  const invalid = evaluateManagedInstallState(config)

  assert.equal(invalid.status, "hard-stop")
  assert.equal(invalid.stop?.code, "invalid_current")
  assert.match(invalid.stop?.message ?? "", /install\/current/)
  assert.throws(() => repairManagedInstallState(config), /managed_install_state_hard_stop:invalid_current/)
  assert.equal(realpathSync(paths.currentLinkPath), currentBefore)
  assert.equal(existsSync(paths.wrapperPath), false)
})

function configForTempDir(): { dataDir: string } {
  return { dataDir: mkdtempSync(join(tmpdir(), "managed-install-state-")) }
}

function releaseRef(tag: string): { tag: string; version: string } {
  return { tag, version: tag.replace(/^v/i, "") }
}

function createValidVersionTree(dataDir: string, tag: string): string {
  const version = tag.replace(/^v/i, "")
  const root = join(dataDir, "install", "versions", tag)
  mkdirSync(join(root, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(root, "apps", "ui"), { recursive: true })
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "beerengineer",
    private: true,
    workspaces: ["apps/*"],
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "package.json"), `${JSON.stringify({
    name: "@beerengineer/engine",
    version,
    bin: { beerengineer: "./bin/beerengineer.js" },
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\n", "utf8")
  return root
}

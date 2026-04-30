import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"

import {
  acquireManagedInstallUpdateLock,
  managedInstallUpdateLockPath,
} from "../src/core/updateMode/lock.js"
import {
  acquireUpdateLock,
  releaseUpdateLock,
  resolveUpdateLockFilePath,
} from "../src/core/updateMode/lock.js"
import {
  activateManagedInstallVersionWithLock,
  resolveManagedInstallStatePaths,
} from "../src/core/managedInstall/state.js"

test("managed install and update share the same lock file", () => {
  const config = configForTempDir()

  assert.equal(managedInstallUpdateLockPath(config), resolveUpdateLockFilePath(config))
})

test("active managed install lock fails hard with retry hint", () => {
  const config = configForTempDir()
  const held = acquireUpdateLock(config, { operationId: "update-active", pid: process.pid })

  assert.throws(
    () => acquireManagedInstallUpdateLock(config, { operationId: "install-attempt" }),
    /managed_install_lock_failed:held:retry_later/,
  )

  releaseUpdateLock(config, held.record.operationId)
})

test("managed install lock blocks concurrent update attempts until released", () => {
  const config = configForTempDir()
  const held = acquireManagedInstallUpdateLock(config, { operationId: "install-active", pid: process.pid })

  const attempts = Array.from({ length: 5 }, (_value, index) => {
    try {
      acquireUpdateLock(config, { operationId: `update-attempt-${index}`, pid: process.pid })
      return "acquired"
    } catch (err) {
      return (err as Error).message
    }
  })

  assert.deepEqual(attempts, [
    "update_lock_held",
    "update_lock_held",
    "update_lock_held",
    "update_lock_held",
    "update_lock_held",
  ])
  assert.equal(readFileSync(managedInstallUpdateLockPath(config), "utf8").includes("install-active"), true)
  assert.equal(releaseUpdateLock(config, held.record.operationId), true)

  const afterRelease = acquireUpdateLock(config, { operationId: "update-after-install", pid: process.pid })
  assert.equal(afterRelease.record.operationId, "update-after-install")
  releaseUpdateLock(config, afterRelease.record.operationId)
})

test("stale lock behavior is shared with update lock reclamation", () => {
  const config = configForTempDir()
  mkdirSync(config.dataDir, { recursive: true })
  writeFileSync(resolveUpdateLockFilePath(config), `${JSON.stringify({
    operationId: "stale-update",
    pid: 999_999_999,
    startedAt: Date.now(),
    host: "test",
  })}\n`, "utf8")

  const lock = acquireManagedInstallUpdateLock(config, { operationId: "install-attempt" })

  assert.equal(lock.reclaimed, true)
  assert.equal(lock.reclaimedFrom?.operationId, "stale-update")
  releaseUpdateLock(config, lock.record.operationId)
})

test("lock failures do not mutate wrapper current config or database state", () => {
  const config = configForTempDir()
  const configPath = join(config.dataDir, "config.json")
  const dbPath = join(config.dataDir, "beerengineer.sqlite")
  mkdirSync(config.dataDir, { recursive: true })
  writeFileSync(configPath, "config\n", "utf8")
  writeFileSync(dbPath, "db\n", "utf8")
  const held = acquireUpdateLock(config, { operationId: "update-active", pid: process.pid })

  assert.throws(
    () => activateManagedInstallVersionWithLock(config, { tag: "v1.0.0", version: "1.0.0" }, { operationId: "install-attempt" }),
    /managed_install_lock_failed:held/,
  )

  const paths = resolveManagedInstallStatePaths(config)
  assert.equal(existsSync(paths.currentLinkPath), false)
  assert.equal(existsSync(paths.wrapperPath), false)
  assert.equal(readFileSync(configPath, "utf8"), "config\n")
  assert.equal(readFileSync(dbPath, "utf8"), "db\n")
  releaseUpdateLock(config, held.record.operationId)
})

function configForTempDir(): { dataDir: string } {
  return { dataDir: mkdtempSync(join(tmpdir(), "managed-install-lock-")) }
}

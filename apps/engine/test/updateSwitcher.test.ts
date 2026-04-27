import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { claimUpdateLock, decideTerminalUpdateStatus, pointManagedInstallPointer, swapManagedInstallPointers, validateRestartedUpdateStatus } from "../bin/update-switcher-lib.js"

test("decideTerminalUpdateStatus marks degraded when hard-kill was needed and no warnings", () => {
  assert.equal(decideTerminalUpdateStatus({ warningKeys: [], degraded: true }), "succeeded-degraded")
})

test("decideTerminalUpdateStatus prefers succeeded-with-warning over degraded when both apply", () => {
  assert.equal(
    decideTerminalUpdateStatus({ warningKeys: ["sonarOk"], degraded: true }),
    "succeeded-with-warning",
  )
})

test("decideTerminalUpdateStatus reports succeeded for the clean path", () => {
  assert.equal(decideTerminalUpdateStatus({ warningKeys: [], degraded: false }), "succeeded")
})

test("validateRestartedUpdateStatus accepts the expected version with core readiness ok and returns warning integrations", () => {
  const result = validateRestartedUpdateStatus(
    { targetVersion: "9.9.9" },
    {
      currentVersion: "9.9.9",
      readiness: {
        engineStarted: "ok",
        dbOk: "ok",
        githubOk: "failed",
        anthropicOk: "ok",
        openaiOk: "failed",
        sonarOk: "not_applicable",
      },
    },
  )

  assert.deepEqual(result.warningKeys, ["githubOk", "openaiOk"])
})

test("validateRestartedUpdateStatus fails on unexpected restarted version", () => {
  assert.throws(
    () => validateRestartedUpdateStatus(
      { targetVersion: "9.9.9" },
      {
        currentVersion: "9.9.8",
        readiness: {
          engineStarted: "ok",
          dbOk: "ok",
        },
      },
    ),
    /unexpected_restarted_version:9\.9\.8:9\.9\.9/,
  )
})

test("validateRestartedUpdateStatus fails when core readiness is not ok", () => {
  assert.throws(
    () => validateRestartedUpdateStatus(
      { targetVersion: "9.9.9" },
      {
        currentVersion: "9.9.9",
        readiness: {
          engineStarted: "ok",
          dbOk: "failed",
        },
      },
    ),
    /restart_core_readiness_failed:dbOk:failed/,
  )
})

test("claimUpdateLock transfers the lock pid to the switcher process", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-switcher-lock-"))
  const lockPath = join(dir, "update.lock")
  writeFileSync(lockPath, JSON.stringify({
    operationId: "op-1",
    pid: 1234,
    startedAt: 1,
    host: "test-host",
  }, null, 2))

  try {
    const claimed = claimUpdateLock(lockPath, "op-1", 9999)
    assert.equal(claimed.pid, 9999)
    const persisted = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; operationId: string }
    assert.equal(persisted.operationId, "op-1")
    assert.equal(persisted.pid, 9999)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("claimUpdateLock rejects a mismatched operation id", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-switcher-lock-mismatch-"))
  const lockPath = join(dir, "update.lock")
  writeFileSync(lockPath, JSON.stringify({
    operationId: "op-1",
    pid: 1234,
    startedAt: 1,
    host: "test-host",
  }, null, 2))

  try {
    assert.throws(() => claimUpdateLock(lockPath, "op-2", 9999), /update_lock_missing_or_mismatched/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("pointManagedInstallPointer creates a symlinked pointer on POSIX-style platforms", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-switcher-pointer-"))
  const target = join(dir, "target")
  const pointer = join(dir, "pointer")
  mkdirSync(target, { recursive: true })

  try {
    const result = pointManagedInstallPointer(pointer, target, "linux")
    assert.equal(result.mode, "symlink")
    assert.equal(lstatSync(pointer).isSymbolicLink(), true)
    assert.equal(readlinkSync(pointer), target)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("swapManagedInstallPointers renames current to previous and next to current on Windows-style platforms", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-switcher-swap-win-"))
  const current = join(dir, "current")
  const previous = join(dir, "previous")
  const next = join(dir, "next")
  mkdirSync(join(current, "apps"), { recursive: true })
  mkdirSync(join(next, "apps"), { recursive: true })
  writeFileSync(join(current, "apps", "old.txt"), "old\n", "utf8")
  writeFileSync(join(next, "apps", "new.txt"), "new\n", "utf8")

  try {
    const result = swapManagedInstallPointers({
      currentPath: current,
      previousPath: previous,
      nextPath: next,
      platform: "win32",
    })
    assert.equal(result.mode, "rename")
    assert.equal(lstatSync(current).isDirectory(), true)
    assert.equal(lstatSync(previous).isDirectory(), true)
    assert.equal(readFileSync(join(current, "apps", "new.txt"), "utf8"), "new\n")
    assert.equal(readFileSync(join(previous, "apps", "old.txt"), "utf8"), "old\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("swapManagedInstallPointers restores current when the second Windows-style rename fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-switcher-swap-rollback-"))
  const current = join(dir, "current")
  const previous = join(dir, "previous")
  const missingNext = join(dir, "missing-next")
  mkdirSync(join(current, "apps"), { recursive: true })
  writeFileSync(join(current, "apps", "old.txt"), "old\n", "utf8")

  try {
    assert.throws(
      () => swapManagedInstallPointers({
        currentPath: current,
        previousPath: previous,
        nextPath: missingNext,
        platform: "win32",
      }),
      /install_swap_failed:.*:restored_current/,
    )
    assert.equal(lstatSync(current).isDirectory(), true)
    assert.equal(readFileSync(join(current, "apps", "old.txt"), "utf8"), "old\n")
    assert.equal(existsSync(previous), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

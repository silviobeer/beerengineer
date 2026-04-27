#!/usr/bin/env node

import { spawn } from "node:child_process"
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { claimUpdateLock, pointManagedInstallPointer, swapManagedInstallPointers, validateRestartedUpdateStatus } from "./update-switcher-lib.js"

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function now() {
  return Date.now()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForShutdown(pidFile, pid, timeoutMs) {
  const deadline = now() + timeoutMs
  let degraded = false
  while (now() < deadline) {
    const pidFileGone = !existsSync(pidFile)
    const processGone = !processAlive(pid)
    if (pidFileGone || processGone) return degraded
    await sleep(500)
  }
  if (processAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
    degraded = true
    await sleep(5000)
  }
  if (processAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
    degraded = true
  }
  return degraded
}

function ensureWrapper(wrapperPath) {
  if (existsSync(wrapperPath)) return
  mkdirSync(dirname(wrapperPath), { recursive: true })
  writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env node",
      "import { spawn } from 'node:child_process'",
      "import { fileURLToPath } from 'node:url'",
      "import { dirname, join } from 'node:path'",
      "const here = dirname(fileURLToPath(import.meta.url))",
      "const entry = join(here, '..', 'install', 'current', 'apps', 'engine', 'bin', 'beerengineer.js')",
      "const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })",
      "child.on('exit', code => process.exit(code ?? 0))",
      "child.on('error', err => { console.error(err.message); process.exit(1) })",
    ].join("\n") + "\n",
    { mode: 0o755 },
  )
}

function startEngine(meta, logPath) {
  mkdirSync(dirname(logPath), { recursive: true })
  const entry = join(meta.install.currentLink, "apps", "engine", "bin", "beerengineer.js")
  const logFd = openSync(logPath, "a")
  const child = spawn(process.execPath, [entry, "start"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  })
  closeSync(logFd)
  child.unref()
  return { entry, logPath }
}

async function waitForHealth(host, port, timeoutMs) {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    const ok = await new Promise(resolve => {
      const req = httpRequest({ host, port, path: "/health", method: "GET" }, res => {
        resolve((res.statusCode ?? 500) === 200)
      })
      req.on("error", () => resolve(false))
      req.end()
    })
    if (ok) return true
    await sleep(5000)
  }
  return false
}

async function fetchUpdateStatus(host, port) {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host, port, path: "/update/status", method: "GET" }, res => {
      const chunks = []
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on("end", () => {
        const statusCode = res.statusCode ?? 500
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`update_status_http_${statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
        } catch {
          reject(new Error("update_status_invalid_json"))
        }
      })
    })
    req.on("error", reject)
    req.end()
  })
}

function appendUpdateLog(meta, event, detail = {}) {
  try {
    mkdirSync(meta.install.logRoot, { recursive: true })
    appendFileSync(
      join(meta.install.logRoot, `${meta.operationId}.log`),
      `${JSON.stringify({ ts: new Date().toISOString(), event, ...detail })}\n`,
      "utf8",
    )
  } catch {}
}

async function verifyDatabaseState(meta) {
  const mod = join(meta.stagedRoot, "node_modules", "better-sqlite3")
  const BetterSqlite3 = (await import(`file://${mod}/lib/index.js`)).default
  const db = new BetterSqlite3(meta.dbPath, { readonly: true })
  try {
    db.prepare("SELECT 1").get()
    const userVersion = db.pragma("user_version", { simple: true })
    if (typeof userVersion !== "number" || userVersion < meta.requiredMigrationLevel) {
      throw new Error(`migration_level_below_required:${userVersion}`)
    }
    return userVersion
  } finally {
    db.close()
  }
}

function readLock(lockPath) {
  if (!existsSync(lockPath)) return null
  try {
    return readJson(lockPath)
  } catch {
    return null
  }
}

function releaseLock(lockPath, operationId) {
  const current = readLock(lockPath)
  if (!current || current.operationId !== operationId) return false
  try {
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

function invokeBackupHelper(meta, metadataPath) {
  const helperPath = join(meta.install.currentLink, "apps", "engine", "bin", "update-backup.js")
  const child = spawn(process.execPath, [helperPath, metadataPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })
  return new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)))
    child.once("error", reject)
    child.once("exit", code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `backup_helper_exit_${code}`))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")))
      } catch {
        reject(new Error("backup_helper_invalid_json"))
      }
    })
  })
}

async function updateAttempt(meta, update) {
  try {
    const mod = join(meta.stagedRoot, "node_modules", "better-sqlite3")
    const BetterSqlite3 = (await import(`file://${mod}/lib/index.js`)).default
    const db = new BetterSqlite3(meta.dbPath)
    const result = db.prepare(
      `UPDATE update_attempts
       SET status = ?, backup_dir = COALESCE(?, backup_dir), error_message = ?, metadata_json = ?, updated_at = ?, completed_at = ?
       WHERE operation_id = ? AND status IN ('queued', 'in-flight')`
    ).run(
      update.status,
      update.backupDir ?? null,
      update.errorMessage ?? null,
      JSON.stringify(update.metadata ?? {}),
      Date.now(),
      Date.now(),
      meta.operationId,
    )
    if (result.changes === 0) {
      db.prepare(
        `INSERT OR REPLACE INTO update_attempts (
           operation_id, kind, status, from_version, target_version, db_path, db_path_source,
           legacy_db_shadow, install_root, backup_dir, error_message, metadata_json, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        meta.operationId,
        "apply",
        update.status,
        meta.currentVersion,
        meta.targetVersion,
        meta.dbPath,
        meta.dbPathSource,
        0,
        meta.install.root ?? null,
        update.backupDir ?? null,
        update.errorMessage ?? null,
        JSON.stringify(update.metadata ?? {}),
        Date.now(),
        Date.now(),
        Date.now(),
      )
    }
    db.close()
  } catch (err) {
    console.error(`[update-switcher] failed to update attempt row: ${err.message}`)
  }
}

async function main() {
  const metadataPath = process.argv[2]
  if (!metadataPath) {
    console.error("usage: update-switcher.js <metadata.json>")
    process.exit(2)
  }

  const meta = readJson(metadataPath)

  try {
    appendUpdateLog(meta, "switcher_started", { metadataPath })
  const lock = readLock(meta.updateLockPath)
  if (!lock || lock.operationId !== meta.operationId) {
    throw new Error("update_lock_missing_or_mismatched")
  }
  appendUpdateLog(meta, "lock_verified", { operationId: meta.operationId })
  const claimedLock = claimUpdateLock(meta.updateLockPath, meta.operationId)
  appendUpdateLog(meta, "lock_claimed_by_switcher", { pid: claimedLock.pid })

  const pidRecord = existsSync(meta.api.pidFile) ? readJson(meta.api.pidFile) : null
  const pid = typeof pidRecord?.pid === "number" ? pidRecord.pid : null
  let degraded = false
  if (pid) {
    degraded = await waitForShutdown(meta.api.pidFile, pid, 30_000)
    appendUpdateLog(meta, "engine_stopped", { pid, degraded })
  }

  const backup = await invokeBackupHelper(meta, metadataPath)
  appendUpdateLog(meta, "backup_created", { backupDir: backup.backupDir })
  const previousCurrent = existsSync(meta.install.currentLink) ? realpathSync(meta.install.currentLink) : null
  if (previousCurrent && process.platform !== "win32") {
    pointManagedInstallPointer(meta.install.previousLink, previousCurrent, process.platform)
  }

  swapManagedInstallPointers({
    currentPath: meta.install.currentLink,
    previousPath: meta.install.previousLink,
    nextPath: meta.stagedRoot,
    platform: process.platform,
  })
  appendUpdateLog(meta, "install_pointer_swapped", {
    currentLink: meta.install.currentLink,
    stagedRoot: meta.stagedRoot,
    previousCurrent,
  })
  ensureWrapper(meta.install.wrapperPath)
  startEngine(meta, join(meta.install.logRoot, `${meta.operationId}.log`))
  appendUpdateLog(meta, "engine_restart_requested", { port: meta.api.enginePort })

  const healthy = await waitForHealth(meta.api.host, meta.api.enginePort, 30_000)
  if (!healthy) {
    appendUpdateLog(meta, "engine_healthcheck_failed")
    if (previousCurrent) {
      swapManagedInstallPointers({
        currentPath: meta.install.currentLink,
        previousPath: meta.install.previousLink,
        nextPath: previousCurrent,
        platform: process.platform,
      })
      ensureWrapper(meta.install.wrapperPath)
      startEngine(meta, join(meta.install.logRoot, `${meta.operationId}.rollback.log`))
      const rollbackHealthy = await waitForHealth(meta.api.host, meta.api.enginePort, 30_000)
      if (rollbackHealthy) {
        appendUpdateLog(meta, "rollback_succeeded", { previousCurrent })
        await updateAttempt(meta, {
          status: "failed-rolled-back",
          backupDir: backup.backupDir,
          errorMessage: "restart_healthcheck_failed",
          metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent },
        })
        releaseLock(meta.updateLockPath, meta.operationId)
        process.exit(1)
      }
    }
    appendUpdateLog(meta, "rollback_unavailable_or_failed", { previousCurrent })
    await updateAttempt(meta, {
      status: "failed-no-rollback",
      backupDir: backup.backupDir,
      errorMessage: "restart_healthcheck_failed",
      metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent },
    })
    releaseLock(meta.updateLockPath, meta.operationId)
    process.exit(1)
  }

  const userVersion = await verifyDatabaseState(meta)
  appendUpdateLog(meta, "database_verified", { userVersion, requiredMigrationLevel: meta.requiredMigrationLevel })
  let restartedStatus = null
  try {
    restartedStatus = await fetchUpdateStatus(meta.api.host, meta.api.enginePort)
    appendUpdateLog(meta, "update_status_fetched")
  } catch (err) {
    console.error(`[update-switcher] post-restart update status probe failed: ${err.message}`)
    appendUpdateLog(meta, "update_status_fetch_failed", { error: err.message })
    if (previousCurrent) {
      swapManagedInstallPointers({
        currentPath: meta.install.currentLink,
        previousPath: meta.install.previousLink,
        nextPath: previousCurrent,
        platform: process.platform,
      })
      ensureWrapper(meta.install.wrapperPath)
      startEngine(meta, join(meta.install.logRoot, `${meta.operationId}.rollback.log`))
      const rollbackHealthy = await waitForHealth(meta.api.host, meta.api.enginePort, 30_000)
      if (rollbackHealthy) {
        appendUpdateLog(meta, "rollback_succeeded", { previousCurrent, cause: "update_status_fetch_failed" })
        await updateAttempt(meta, {
          status: "failed-rolled-back",
          backupDir: backup.backupDir,
          errorMessage: `update_status_fetch_failed:${err.message}`,
          metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent },
        })
        releaseLock(meta.updateLockPath, meta.operationId)
        process.exit(1)
      }
    }
    appendUpdateLog(meta, "rollback_unavailable_or_failed", { previousCurrent, cause: "update_status_fetch_failed" })
    await updateAttempt(meta, {
      status: "failed-no-rollback",
      backupDir: backup.backupDir,
      errorMessage: `update_status_fetch_failed:${err.message}`,
      metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent },
    })
    releaseLock(meta.updateLockPath, meta.operationId)
    process.exit(1)
  }
  let warningKeys = []
  try {
    ;({ warningKeys } = validateRestartedUpdateStatus(meta, restartedStatus))
    appendUpdateLog(meta, "update_status_validated", {
      currentVersion: restartedStatus.currentVersion,
      warningKeys,
    })
  } catch (err) {
    appendUpdateLog(meta, "update_status_validation_failed", { error: err.message })
    if (previousCurrent) {
      swapManagedInstallPointers({
        currentPath: meta.install.currentLink,
        previousPath: meta.install.previousLink,
        nextPath: previousCurrent,
        platform: process.platform,
      })
      ensureWrapper(meta.install.wrapperPath)
      startEngine(meta, join(meta.install.logRoot, `${meta.operationId}.rollback.log`))
      const rollbackHealthy = await waitForHealth(meta.api.host, meta.api.enginePort, 30_000)
      if (rollbackHealthy) {
        appendUpdateLog(meta, "rollback_succeeded", { previousCurrent, cause: "update_status_validation_failed" })
        await updateAttempt(meta, {
          status: "failed-rolled-back",
          backupDir: backup.backupDir,
          errorMessage: `update_status_validation_failed:${err.message}`,
          metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent, restartedStatus },
        })
        releaseLock(meta.updateLockPath, meta.operationId)
        process.exit(1)
      }
    }
    appendUpdateLog(meta, "rollback_unavailable_or_failed", { previousCurrent, cause: "update_status_validation_failed" })
    await updateAttempt(meta, {
      status: "failed-no-rollback",
      backupDir: backup.backupDir,
      errorMessage: `update_status_validation_failed:${err.message}`,
      metadata: { backup: backup.manifest, stagedRoot: meta.stagedRoot, previousCurrent, restartedStatus },
    })
    releaseLock(meta.updateLockPath, meta.operationId)
    process.exit(1)
  }
  await updateAttempt(meta, {
    status: warningKeys.length > 0
      ? "succeeded-with-warning"
      : degraded
      ? "succeeded-degraded"
      : "succeeded",
    backupDir: backup.backupDir,
    metadata: {
      backup: backup.manifest,
      stagedRoot: meta.stagedRoot,
      previousCurrent,
      userVersion,
      readinessWarnings: warningKeys,
      restartedStatus,
    },
  })
  appendUpdateLog(meta, "switcher_completed", {
    terminalStatus: warningKeys.length > 0
      ? "succeeded-with-warning"
      : degraded
      ? "succeeded-degraded"
      : "succeeded",
  })
  releaseLock(meta.updateLockPath, meta.operationId)
  } catch (err) {
    console.error(`[update-switcher] ${err.message}`)
    try {
      appendUpdateLog(meta, "switcher_failed", { error: err.message })
    } catch {}
    try {
      releaseLock(meta.updateLockPath, meta.operationId)
    } catch {}
    process.exit(1)
  }
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntrypoint) {
  void main()
}

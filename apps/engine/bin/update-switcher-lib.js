import { dirname } from "node:path"
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"

export function decideTerminalUpdateStatus({ warningKeys, degraded }) {
  if (Array.isArray(warningKeys) && warningKeys.length > 0) return "succeeded-with-warning"
  if (degraded) return "succeeded-degraded"
  return "succeeded"
}

export function readinessWarnings(status) {
  const readiness = status?.readiness
  if (!readiness || typeof readiness !== "object") return []
  const warnings = []
  for (const key of ["githubOk", "anthropicOk", "openaiOk", "sonarOk"]) {
    if (readiness[key] === "failed") warnings.push(key)
  }
  return warnings
}

export function validateRestartedUpdateStatus(meta, status) {
  if (!status || typeof status !== "object") {
    throw new Error("update_status_missing")
  }
  if (status.currentVersion !== meta.targetVersion) {
    throw new Error(`unexpected_restarted_version:${status.currentVersion ?? "unknown"}:${meta.targetVersion}`)
  }
  const readiness = status.readiness
  if (!readiness || typeof readiness !== "object") {
    throw new Error("update_status_missing_readiness")
  }
  if (readiness.engineStarted !== "ok") {
    throw new Error(`restart_core_readiness_failed:engineStarted:${readiness.engineStarted ?? "unknown"}`)
  }
  if (readiness.dbOk !== "ok") {
    throw new Error(`restart_core_readiness_failed:dbOk:${readiness.dbOk ?? "unknown"}`)
  }
  return {
    warningKeys: readinessWarnings(status),
  }
}

export function claimUpdateLock(lockPath, operationId, pid = process.pid) {
  const raw = JSON.parse(readFileSync(lockPath, "utf8"))
  if (!raw || raw.operationId !== operationId) {
    throw new Error("update_lock_missing_or_mismatched")
  }
  const next = {
    ...raw,
    pid,
  }
  writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}

export function pointManagedInstallPointer(pointerPath, targetPath, platform = process.platform) {
  if (platform === "win32") {
    rmSync(pointerPath, { recursive: true, force: true })
    return { mode: "noop" }
  }

  mkdirSync(dirname(pointerPath), { recursive: true })
  const tmpPath = `${pointerPath}.tmp-${process.pid}`
  try {
    unlinkSync(tmpPath)
  } catch {}
  symlinkSync(targetPath, tmpPath, "dir")
  renameSync(tmpPath, pointerPath)
  return { mode: "symlink" }
}

export function swapManagedInstallPointers({
  currentPath,
  previousPath,
  nextPath,
  platform = process.platform,
  rollbackOnFailure = true,
}) {
  if (platform === "win32") {
    rmSync(previousPath, { recursive: true, force: true })
    let movedCurrentToPrevious = false
    try {
      renameSync(currentPath, previousPath)
      movedCurrentToPrevious = true
      renameSync(nextPath, currentPath)
      return { mode: "rename", rolledBackOnFailure: false }
    } catch (err) {
      let restoredCurrent = false
      if (rollbackOnFailure && movedCurrentToPrevious) {
        try {
          renameSync(previousPath, currentPath)
          restoredCurrent = true
        } catch {}
      }
      throw new Error(`install_swap_failed:${err instanceof Error ? err.message : String(err)}:${restoredCurrent ? "restored_current" : "current_not_restored"}`)
    }
  }

  pointManagedInstallPointer(currentPath, nextPath, platform)
  return { mode: "symlink", rolledBackOnFailure: false }
}

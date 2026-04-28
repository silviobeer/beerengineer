import { resolveDbPathInfo } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import { readLatestBackup } from "./backup.js"
import { latestAttemptPayload, legacyShadowWarning } from "./attempts.js"
import { readUpdateLock, updateLockPath } from "./lock.js"
import { buildUpdateReadiness } from "./readiness.js"
import { readCachedRelease } from "./release.js"
import { compareVersions, currentAppVersion, resolveGithubRepo, resolveManagedInstallPaths } from "./shared.js"
import type { UpdateCheckResult, UpdateStatus } from "./types.js"

export function buildUpdateStatus(
  repos: Repos,
  config: AppConfig,
  opts: { pid?: number | null; latestRelease?: UpdateCheckResult["latestRelease"] | null } = {},
): UpdateStatus {
  const currentVersion = currentAppVersion()
  const githubRepo = resolveGithubRepo()
  const db = resolveDbPathInfo()
  const install = resolveManagedInstallPaths(config)
  const lock = readUpdateLock(updateLockPath(config))
  const activeRuns = repos.listRunningRuns().length
  const latestRelease = opts.latestRelease ?? readCachedRelease(config)?.latestRelease ?? null
  return {
    currentVersion,
    githubRepo,
    dbPath: db.path,
    dbPathSource: db.source,
    warnings: db.warnings,
    install,
    preflight: {
      idle: activeRuns === 0,
      activeRuns,
      lockHeld: lock.held,
      lockStale: lock.stale,
      pid: opts.pid ?? null,
      httpPort: config.enginePort,
    },
    latestRelease,
    updateAvailable: latestRelease ? compareVersions(latestRelease.version, currentVersion) > 0 : null,
    lastBackup: readLatestBackup(install.backupRoot),
    readiness: buildUpdateReadiness(repos, config, { pid: opts.pid ?? null }),
    latestAttempt: latestAttemptPayload(repos.listUpdateAttempts(1)[0]),
  }
}

export function assertUpdateSafety(
  status: Pick<UpdateStatus, "warnings" | "preflight" | "dbPathSource">,
  allowLegacyDbShadow = false,
): void {
  if (!status.preflight.idle) throw new Error("update_preflight_failed:active_runs")
  if (status.preflight.lockHeld && !status.preflight.lockStale) throw new Error("update_preflight_failed:lock_held")
  if (!allowLegacyDbShadow && status.dbPathSource === "legacy") {
    throw new Error("update_preflight_failed:legacy_db_shadow")
  }
  if (!allowLegacyDbShadow && legacyShadowWarning(status)) {
    throw new Error("update_preflight_failed:legacy_db_shadow")
  }
}

export type {
  DatabaseBackupRecord,
  UpdateApplyResult,
  UpdateCheckResult,
  UpdateDryRunResult,
  UpdateDryRunStage,
  UpdateExecutionStartResult,
  UpdateHistoryEntry,
  UpdateLockRecord,
  UpdateLockState,
  UpdateReadinessState,
  UpdateStatus,
} from "./updateMode/types.js"

export {
  resolveNpmCommandForPlatform,
  resolveSwitcherScriptExtension,
  currentAppVersion,
  resolveGithubRepo,
  resolveManagedInstallWrapperPath,
  resolveManagedInstallPaths,
} from "./updateMode/shared.js"

export {
  resolveUpdateLockFilePath,
  managedInstallUpdateLockPath,
  acquireManagedInstallUpdateLock,
  readUpdateLock,
  acquireUpdateLock,
  releaseUpdateLock,
} from "./updateMode/lock.js"

export { createDatabaseBackup, listBackupHistory } from "./updateMode/backup.js"

export {
  fetchLatestGithubRelease,
  fetchGithubReleaseByTag,
  runUpdateCheck,
  readCachedRelease,
} from "./updateMode/release.js"

export {
  replayPreparedUpdateApply,
  markPreparedUpdateInFlight,
  listUpdateHistory,
} from "./updateMode/attempts.js"

export { buildUpdateStatus } from "./updateMode/status.js"

export { runUpdateDryRun, prepareUpdateApply } from "./updateMode/workflow.js"

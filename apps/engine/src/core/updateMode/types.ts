import type { ResolvedDbPathInfo } from "../../db/connection.js"

export type UpdateCheckResult = {
  checkedAt: string
  currentVersion: string
  githubRepo: string
  latestRelease: {
    tag: string
    version: string
    publishedAt: string | null
    tarballUrl: string
    url: string
  }
  updateAvailable: boolean
}

export type DatabaseBackupRecord = {
  backupDir: string
  sourceDbPath: string
  sourceDbPathSource: ResolvedDbPathInfo["source"]
  createdAt: string
  fromVersion: string
  targetVersion: string
  operationId: string
  sqliteSha256: string
  files: Array<{ name: string; bytes: number }>
}

export type UpdateDryRunStage = {
  name: "preflight" | "release" | "lock" | "download" | "unpack" | "validate" | "install" | "filesystem" | "switcher"
  status: "pass" | "fail"
  detail: string
}

export type UpdateDryRunResult = {
  operationId: string
  kind: "dry-run"
  status: "aborted-dry-run" | "failed"
  currentVersion: string
  targetRelease: UpdateCheckResult["latestRelease"]
  githubRepo: string
  stages: UpdateDryRunStage[]
  reclaimedLock: boolean
  warnings: string[]
}

export type UpdateApplyResult = {
  operationId: string
  state: "queued" | "in-flight"
  currentVersion: string
  targetRelease: UpdateCheckResult["latestRelease"]
  githubRepo: string
  stagedRoot: string
  switcherPath: string
  metadataPath: string
  warnings: string[]
}

export type UpdateReadinessState = "ok" | "failed" | "not_applicable"

export type UpdateExecutionStartResult = {
  started: boolean
  reason: string
}

export type UpdateStatus = {
  currentVersion: string
  githubRepo: string
  dbPath: string
  dbPathSource: ResolvedDbPathInfo["source"]
  warnings: string[]
  install: {
    root: string
    versionsDir: string
    currentPath: string | null
    previousPath: string | null
    wrapperPath: string
    switcherDir: string
    backupRoot: string
    logRoot: string
  }
  preflight: {
    idle: boolean
    activeRuns: number
    lockHeld: boolean
    lockStale: boolean
    pid: number | null
    httpPort: number
  }
  latestRelease: UpdateCheckResult["latestRelease"] | null
  updateAvailable: boolean | null
  lastBackup: DatabaseBackupRecord | null
  readiness: {
    engineStarted: UpdateReadinessState
    dbOk: UpdateReadinessState
    githubOk: UpdateReadinessState
    anthropicOk: UpdateReadinessState
    openaiOk: UpdateReadinessState
    sonarOk: UpdateReadinessState
  }
  latestAttempt: null | {
    operationId: string
    kind: string
    status: string
    fromVersion: string | null
    targetVersion: string | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
    errorMessage: string | null
  }
}

export type UpdateHistoryEntry = {
  operationId: string
  kind: string
  status: string
  fromVersion: string | null
  targetVersion: string | null
  dbPath: string | null
  dbPathSource: string | null
  legacyDbShadow: boolean
  installRoot: string | null
  backupDir: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type UpdateLockRecord = {
  operationId: string
  pid: number
  startedAt: number
  host: string
}

export type UpdateLockState = {
  held: boolean
  stale: boolean
  record: UpdateLockRecord | null
}

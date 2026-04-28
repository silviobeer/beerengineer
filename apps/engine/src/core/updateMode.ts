import Database from "better-sqlite3"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import { dirname, join, resolve } from "node:path"
import { URL, fileURLToPath } from "node:url"
import type { Repos, UpdateAttemptRow } from "../db/repositories.js"
import { resolveDbPathInfo, type ResolvedDbPathInfo } from "../db/connection.js"
import type { AppConfig } from "../setup/types.js"
import { REQUIRED_MIGRATION_LEVEL } from "../setup/config.js"
import { resolveApiTokenFilePath } from "../api/tokenFile.js"
import { readEnginePidFile, resolveEnginePidFilePath } from "../api/pidFile.js"

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

type ReleasePayload = {
  tag_name?: unknown
  tarball_url?: unknown
  html_url?: unknown
  published_at?: unknown
}

const ENGINE_PACKAGE_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json")
const DEFAULT_GITHUB_REPO = process.env.BEERENGINEER_UPDATE_GITHUB_REPO?.trim() || "silviobeer/beerengineer"
const DEFAULT_GITHUB_API_BASE = process.env.BEERENGINEER_UPDATE_GITHUB_API_BASE_URL?.trim() || "https://api.github.com"
const EXPECTED_TARBALL_SHA256 = process.env.BEERENGINEER_UPDATE_EXPECTED_TARBALL_SHA256?.trim() || null
const STALE_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000
const RELEASE_CACHE_TTL_MS = 60_000
const BACKUP_RETENTION_COUNT = 5

let cachedVersion: string | null = null

export function resolveNpmCommandForPlatform(platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm"
}

export function resolveSwitcherScriptExtension(platform = process.platform): "cmd" | "sh" {
  return platform === "win32" ? "cmd" : "sh"
}

function safeReadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return null
  }
}

export function currentAppVersion(): string {
  if (cachedVersion) return cachedVersion
  const parsed = safeReadJson<{ version?: unknown }>(ENGINE_PACKAGE_JSON)
  cachedVersion = typeof parsed?.version === "string" && parsed.version.trim() ? parsed.version.trim() : "0.0.0"
  return cachedVersion
}

export function resolveGithubRepo(): string {
  return DEFAULT_GITHUB_REPO
}

export function resolveManagedInstallPaths(config: Pick<AppConfig, "dataDir">): UpdateStatus["install"] {
  const installRoot = resolve(config.dataDir, "install")
  return {
    root: installRoot,
    versionsDir: join(installRoot, "versions"),
    currentPath: resolvePointer(join(installRoot, "current")),
    previousPath: resolvePointer(join(installRoot, "previous")),
    wrapperPath: join(config.dataDir, "bin", "beerengineer"),
    switcherDir: join(installRoot, ".switcher"),
    backupRoot: join(config.dataDir, "backups", "update"),
    logRoot: join(config.dataDir, "logs", "update"),
  }
}

function resolvePointer(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || stat.isDirectory()) return realpathSync(path)
    return path
  } catch {
    return null
  }
}

function parseVersionParts(input: string): number[] {
  const core = input.trim().replace(/^v/i, "").split("-")[0] ?? "0"
  return core.split(".").map(part => {
    const n = Number(part)
    return Number.isFinite(n) ? n : 0
  })
}

function compareVersions(a: string, b: string): number {
  const aa = parseVersionParts(a)
  const bb = parseVersionParts(b)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i += 1) {
    const av = aa[i] ?? 0
    const bv = bb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

function normalizeReleaseTag(tag: string): string {
  return tag.trim().replace(/^v/i, "")
}

function latestAttemptPayload(row: UpdateAttemptRow | undefined): UpdateStatus["latestAttempt"] {
  if (!row) return null
  return {
    operationId: row.operation_id,
    kind: row.kind,
    status: row.status,
    fromVersion: row.from_version,
    targetVersion: row.target_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    errorMessage: row.error_message,
  }
}

function parseMetadataJson(row: Pick<UpdateAttemptRow, "metadata_json">): Record<string, unknown> {
  if (!row.metadata_json) return {}
  try {
    return JSON.parse(row.metadata_json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function historyPayload(row: UpdateAttemptRow): UpdateHistoryEntry {
  return {
    operationId: row.operation_id,
    kind: row.kind,
    status: row.status,
    fromVersion: row.from_version,
    targetVersion: row.target_version,
    dbPath: row.db_path,
    dbPathSource: row.db_path_source,
    legacyDbShadow: row.legacy_db_shadow === 1,
    installRoot: row.install_root,
    backupDir: row.backup_dir,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  }
}

function updateLockPath(config: Pick<AppConfig, "dataDir">): string {
  return join(config.dataDir, "update.lock")
}

export function resolveUpdateLockFilePath(config: Pick<AppConfig, "dataDir">): string {
  return updateLockPath(config)
}

function isStartedAtStale(startedAt: number | null): boolean {
  return startedAt !== null && Date.now() - startedAt > STALE_LOCK_MAX_AGE_MS
}

export function readUpdateLock(lockPath: string): UpdateLockState {
  if (!existsSync(lockPath)) return { held: false, stale: false, record: null }
  const parsed = safeReadJson<Partial<UpdateLockRecord>>(lockPath)
  if (!parsed) return { held: true, stale: false, record: null }
  const pid = typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : null
  const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : null
  const operationId = typeof parsed.operationId === "string" && parsed.operationId.trim()
    ? parsed.operationId.trim()
    : null
  const host = typeof parsed.host === "string" && parsed.host.trim() ? parsed.host.trim() : "unknown"
  let processMissing = false
  if (pid !== null) {
    try {
      process.kill(pid, 0)
    } catch {
      processMissing = true
    }
  }
  return {
    held: true,
    stale: processMissing || isStartedAtStale(startedAt),
    record: pid !== null && startedAt !== null && operationId
      ? { pid, startedAt, operationId, host }
      : null,
  }
}

export function acquireUpdateLock(
  config: Pick<AppConfig, "dataDir">,
  opts: { operationId?: string; pid?: number } = {},
): { path: string; record: UpdateLockRecord; reclaimed: boolean; reclaimedFrom: UpdateLockRecord | null } {
  const path = updateLockPath(config)
  mkdirSync(dirname(path), { recursive: true })
  const record: UpdateLockRecord = {
    operationId: opts.operationId ?? randomUUID(),
    pid: opts.pid ?? process.pid,
    startedAt: Date.now(),
    host: hostname(),
  }
  const write = (): void => {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  }
  try {
    write()
    return { path, record, reclaimed: false, reclaimedFrom: null }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw err
    const existing = readUpdateLock(path)
    if (!existing.stale) {
      throw new Error("update_lock_held")
    }
    try {
      unlinkSync(path)
    } catch {}
    write()
    return { path, record, reclaimed: true, reclaimedFrom: existing.record }
  }
}

export function releaseUpdateLock(config: Pick<AppConfig, "dataDir">, operationId?: string): boolean {
  const path = updateLockPath(config)
  if (!existsSync(path)) return false
  if (operationId) {
    const existing = readUpdateLock(path)
    if (existing.record?.operationId && existing.record.operationId !== operationId) return false
  }
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function backupManifestPath(dir: string): string {
  return join(dir, "manifest.json")
}

function readBackupManifest(dir: string): DatabaseBackupRecord | null {
  const parsed = safeReadJson<Omit<DatabaseBackupRecord, "backupDir">>(backupManifestPath(dir))
  if (!parsed) return null
  return { ...parsed, backupDir: dir }
}

function readLatestBackup(backupRoot: string): DatabaseBackupRecord | null {
  return listDatabaseBackups(backupRoot, 1)[0] ?? null
}

function listDatabaseBackups(backupRoot: string, limit = 20): DatabaseBackupRecord[] {
  if (!existsSync(backupRoot)) return []
  const backups = readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readBackupManifest(join(backupRoot, entry.name)))
    .filter((entry): entry is DatabaseBackupRecord => entry !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return backups.slice(0, Math.max(1, limit))
}

function pruneBackupRetention(backupRoot: string, currentBackupDir: string): void {
  if (!existsSync(backupRoot)) return
  const backups = readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readBackupManifest(join(backupRoot, entry.name)))
    .filter((entry): entry is DatabaseBackupRecord => entry !== null)
    .filter(entry => entry.backupDir !== currentBackupDir)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  backups.slice(BACKUP_RETENTION_COUNT - 1).forEach(entry => {
    rmSync(entry.backupDir, { recursive: true, force: true })
  })
}

function sha256File(path: string): string {
  const buf = readFileSync(path)
  return createHash("sha256").update(buf).digest("hex")
}

export function createDatabaseBackup(
  config: Pick<AppConfig, "dataDir">,
  opts: {
    operationId: string
    fromVersion: string
    targetVersion: string
    db: ResolvedDbPathInfo
  },
): DatabaseBackupRecord {
  const install = resolveManagedInstallPaths(config)
  mkdirSync(install.backupRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/:/g, "-")
  const backupDir = join(install.backupRoot, `${stamp}-${opts.fromVersion}-to-${opts.targetVersion}`)
  mkdirSync(backupDir, { recursive: true })

  const checkpointDb = new Database(opts.db.path, { fileMustExist: true })
  try {
    checkpointDb.pragma("wal_checkpoint(TRUNCATE)")
  } finally {
    checkpointDb.close()
  }

  const files: Array<{ name: string; bytes: number }> = []
  for (const name of ["beerengineer.sqlite", "beerengineer.sqlite-wal", "beerengineer.sqlite-shm"]) {
    const src = name === "beerengineer.sqlite" ? opts.db.path : `${opts.db.path}${name === "beerengineer.sqlite" ? "" : name.slice("beerengineer.sqlite".length)}`
    if (!existsSync(src)) continue
    const dest = join(backupDir, name)
    copyFileSync(src, dest)
    files.push({ name, bytes: readFileSync(dest).byteLength })
  }

  const sqliteSha256 = sha256File(join(backupDir, "beerengineer.sqlite"))
  const manifest: DatabaseBackupRecord = {
    backupDir,
    sourceDbPath: opts.db.path,
    sourceDbPathSource: opts.db.source,
    createdAt: new Date().toISOString(),
    fromVersion: opts.fromVersion,
    targetVersion: opts.targetVersion,
    operationId: opts.operationId,
    sqliteSha256,
    files,
  }
  writeFileSync(backupManifestPath(backupDir), `${JSON.stringify({
    sourceDbPath: manifest.sourceDbPath,
    sourceDbPathSource: manifest.sourceDbPathSource,
    createdAt: manifest.createdAt,
    fromVersion: manifest.fromVersion,
    targetVersion: manifest.targetVersion,
    operationId: manifest.operationId,
    sqliteSha256: manifest.sqliteSha256,
    files: manifest.files,
  }, null, 2)}\n`, "utf8")
  pruneBackupRetention(install.backupRoot, backupDir)
  return manifest
}

function legacyShadowWarning(status: Pick<UpdateStatus, "warnings">): string | null {
  return status.warnings.find(w => w.startsWith("legacy-db-shadow:")) ?? null
}

function assertUpdateSafety(
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

type ReleaseCacheRecord = {
  checkedAt: string
  githubRepo: string
  currentVersion: string
  latestRelease: UpdateCheckResult["latestRelease"]
}

function releaseCachePath(config: Pick<AppConfig, "dataDir">): string {
  return join(config.dataDir, "cache", "github-release.json")
}

export function readCachedRelease(config: Pick<AppConfig, "dataDir">): UpdateCheckResult | null {
  const path = releaseCachePath(config)
  if (!existsSync(path)) return null
  const parsed = safeReadJson<ReleaseCacheRecord>(path)
  if (!parsed || typeof parsed.checkedAt !== "string" || !parsed.latestRelease) return null
  const checkedAtMs = Date.parse(parsed.checkedAt)
  if (!Number.isFinite(checkedAtMs) || Date.now() - checkedAtMs > RELEASE_CACHE_TTL_MS) return null
  return {
    checkedAt: parsed.checkedAt,
    currentVersion: typeof parsed.currentVersion === "string" ? parsed.currentVersion : currentAppVersion(),
    githubRepo: typeof parsed.githubRepo === "string" ? parsed.githubRepo : resolveGithubRepo(),
    latestRelease: parsed.latestRelease,
    updateAvailable: compareVersions(parsed.latestRelease.version, currentAppVersion()) > 0,
  }
}

function writeCachedRelease(config: Pick<AppConfig, "dataDir">, result: UpdateCheckResult): void {
  const path = releaseCachePath(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    checkedAt: result.checkedAt,
    githubRepo: result.githubRepo,
    currentVersion: result.currentVersion,
    latestRelease: result.latestRelease,
  }, null, 2)}\n`, "utf8")
}

function releasePayloadToResult(payload: ReleasePayload): UpdateCheckResult["latestRelease"] {
  const tag = typeof payload.tag_name === "string" && payload.tag_name.trim()
    ? payload.tag_name.trim()
    : null
  const tarballUrl = typeof payload.tarball_url === "string" && payload.tarball_url.trim()
    ? payload.tarball_url.trim()
    : null
  const url = typeof payload.html_url === "string" && payload.html_url.trim()
    ? payload.html_url.trim()
    : null
  if (!tag || !tarballUrl || !url) {
    throw new Error("update_check_failed:invalid_github_payload")
  }
  return {
    tag,
    version: normalizeReleaseTag(tag),
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
    tarballUrl,
    url,
  }
}

export async function fetchLatestGithubRelease(
  opts: { repo?: string; apiBaseUrl?: string } = {},
): Promise<UpdateCheckResult["latestRelease"]> {
  const repo = opts.repo?.trim() || resolveGithubRepo()
  const apiBase = opts.apiBaseUrl?.trim() || DEFAULT_GITHUB_API_BASE
  const payload = await requestJson<ReleasePayload>(`${apiBase.replace(/\/$/, "")}/repos/${repo}/releases/latest`)
  return releasePayloadToResult(payload)
}

export async function fetchGithubReleaseByTag(
  tag: string,
  opts: { repo?: string; apiBaseUrl?: string } = {},
): Promise<UpdateCheckResult["latestRelease"]> {
  const repo = opts.repo?.trim() || resolveGithubRepo()
  const apiBase = opts.apiBaseUrl?.trim() || DEFAULT_GITHUB_API_BASE
  const normalizedTag = tag.trim().startsWith("v") ? tag.trim() : `v${tag.trim()}`
  const payload = await requestJson<ReleasePayload>(`${apiBase.replace(/\/$/, "")}/repos/${repo}/releases/tags/${encodeURIComponent(normalizedTag)}`)
  return releasePayloadToResult(payload)
}

export async function runUpdateCheck(
  config: Pick<AppConfig, "dataDir">,
  opts: { repo?: string; apiBaseUrl?: string; bypassCache?: boolean; version?: string } = {},
): Promise<UpdateCheckResult> {
  if (!opts.bypassCache && !opts.version) {
    const cached = readCachedRelease(config)
    if (cached) return cached
  }
  const currentVersion = currentAppVersion()
  const githubRepo = opts.repo?.trim() || resolveGithubRepo()
  const latestRelease = opts.version
    ? await fetchGithubReleaseByTag(opts.version, opts)
    : await fetchLatestGithubRelease(opts)
  const result = {
    checkedAt: new Date().toISOString(),
    currentVersion,
    githubRepo,
    latestRelease,
    updateAvailable: compareVersions(latestRelease.version, currentVersion) > 0,
  }
  if (!opts.version) writeCachedRelease(config, result)
  return result
}

function resolveGithubAuthToken(): string | null {
  const explicit = process.env.BEERENGINEER_GITHUB_TOKEN?.trim()
  if (explicit) return explicit
  const generic = process.env.GITHUB_TOKEN?.trim()
  if (generic) return generic
  // Probe `gh --version` first so hosts without the CLI fail fast and
  // silently — running `gh auth token` on a missing binary writes spurious
  // ENOENT noise to stderr.
  if (!commandSucceeds("gh", ["--version"])) return null
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" })
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim()
  return null
}

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, { stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}

function integrationReady(state: boolean): UpdateReadinessState {
  return state ? "ok" : "failed"
}

function buildUpdateReadiness(repos: Repos, config: AppConfig, opts: { pid?: number | null } = {}): UpdateStatus["readiness"] {
  const pid = opts.pid ?? null
  const engineStarted = pid !== null ? integrationReady(true) : integrationReady(Boolean(readEnginePidFile()))
  let dbOk: UpdateReadinessState = "failed"
  try {
    const db = new Database(resolveDbPathInfo().path, { readonly: true, fileMustExist: true })
    db.prepare("SELECT 1").get()
    db.close()
    dbOk = "ok"
  } catch {
    dbOk = "failed"
  }

  const githubOk: UpdateReadinessState = resolveGithubAuthToken() || config.vcs?.github?.enabled !== false
    ? "ok"
    : "failed"

  const claudeAuth = Boolean(process.env.ANTHROPIC_API_KEY?.trim()) || commandSucceeds("claude", ["auth", "status"])
  const codexAuth = Boolean(process.env.OPENAI_API_KEY?.trim()) || commandSucceeds("codex", ["login", "status"])
  const anthropicOk: UpdateReadinessState = config.llm.provider === "anthropic" ? integrationReady(claudeAuth) : "not_applicable"
  const openaiOk: UpdateReadinessState = config.llm.provider === "openai" ? integrationReady(codexAuth) : "not_applicable"
  const sonarEnabled = repos.listWorkspaces().some(workspace => workspace.sonar_enabled === 1)
  const sonarTokenPresent = Boolean(process.env.SONAR_TOKEN?.trim()) || repos.listWorkspaces().some(workspace => {
    if (!workspace.root_path) return false
    try {
      const envLocal = join(workspace.root_path, ".env.local")
      if (!existsSync(envLocal)) return false
      return readFileSync(envLocal, "utf8")
        .split(/\r?\n/)
        .some(line => /^SONAR_TOKEN=.+$/.test(line.trim()))
    } catch {
      return false
    }
  })
  const sonarOk: UpdateReadinessState = sonarEnabled ? integrationReady(sonarTokenPresent) : "not_applicable"

  return {
    engineStarted,
    dbOk,
    githubOk,
    anthropicOk,
    openaiOk,
    sonarOk,
  }
}

export function replayPreparedUpdateApply(row: UpdateAttemptRow): UpdateApplyResult | null {
  if (row.kind !== "apply" || (row.status !== "queued" && row.status !== "in-flight")) return null
  const metadata = parseMetadataJson(row)
  const targetRelease = metadata.targetRelease
  const warnings = metadata.warnings
  if (
    typeof metadata.githubRepo !== "string" ||
    typeof metadata.stagedRoot !== "string" ||
    typeof metadata.switcherPath !== "string" ||
    typeof metadata.metadataPath !== "string" ||
    !targetRelease ||
    typeof targetRelease !== "object"
  ) {
    return null
  }
  const release = targetRelease as Record<string, unknown>
  if (
    typeof release.tag !== "string" ||
    typeof release.version !== "string" ||
    typeof release.tarballUrl !== "string" ||
    typeof release.url !== "string"
  ) {
    return null
  }
  return {
    operationId: row.operation_id,
    state: row.status,
    currentVersion: row.from_version ?? currentAppVersion(),
    targetRelease: {
      tag: release.tag,
      version: release.version,
      publishedAt: typeof release.publishedAt === "string" ? release.publishedAt : null,
      tarballUrl: release.tarballUrl,
      url: release.url,
    },
    githubRepo: metadata.githubRepo,
    stagedRoot: metadata.stagedRoot,
    switcherPath: metadata.switcherPath,
    metadataPath: metadata.metadataPath,
    warnings: Array.isArray(warnings) ? warnings.filter((entry): entry is string => typeof entry === "string") : [],
  }
}

function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = resolveGithubAuthToken()
  return {
    accept: "application/vnd.github+json",
    "user-agent": "beerengineer-updater",
    connection: "close",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

function normalizeDownloadHostname(input: string): string {
  return input.trim().toLowerCase()
}

function allowedDownloadHostnames(urlString: string): Set<string> {
  const url = new URL(urlString)
  return new Set([
    normalizeDownloadHostname(url.hostname),
    "codeload.github.com",
    "github.com",
  ])
}

function assertTrustedDownloadUrl(urlString: string, allowedHosts: Set<string>): void {
  const url = new URL(urlString)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`update_download_failed:unsupported_protocol:${url.protocol}`)
  }
  const hostname = normalizeDownloadHostname(url.hostname)
  if (!allowedHosts.has(hostname)) {
    throw new Error(`update_download_failed:untrusted_redirect_host:${hostname}`)
  }
}

async function requestBuffer(
  urlString: string,
  opts: { headers?: Record<string, string>; redirectLimit?: number; allowedHosts?: Set<string> } = {},
): Promise<{ body: Buffer; finalUrl: string }> {
  const redirectLimit = opts.redirectLimit ?? 5
  const allowedHosts = opts.allowedHosts ?? allowedDownloadHostnames(urlString)
  return await new Promise((resolvePromise, reject) => {
    try {
      assertTrustedDownloadUrl(urlString, allowedHosts)
    } catch (err) {
      reject(err)
      return
    }
    const url = new URL(urlString)
    const requestImpl = url.protocol === "http:" ? httpRequest : httpsRequest
    const req = requestImpl(url, {
      method: "GET",
      headers: requestHeaders(opts.headers),
    }, res => {
      const statusCode = res.statusCode ?? 500
      const location = res.headers.location
      if (statusCode >= 300 && statusCode < 400 && location) {
        if (redirectLimit <= 0) {
          reject(new Error("update_download_failed:too_many_redirects"))
          return
        }
        const nextUrl = new URL(location, url).toString()
        try {
          assertTrustedDownloadUrl(nextUrl, allowedHosts)
        } catch (err) {
          reject(err)
          return
        }
        void requestBuffer(nextUrl, {
          headers: opts.headers,
          redirectLimit: redirectLimit - 1,
          allowedHosts,
        })
          .then(resolvePromise)
          .catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on("end", () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`update_check_failed:github_http_${statusCode}`))
          return
        }
        try {
          assertTrustedDownloadUrl(url.toString(), allowedHosts)
        } catch (err) {
          reject(err)
          return
        }
        resolvePromise({ body: Buffer.concat(chunks), finalUrl: url.toString() })
      })
    })
    req.on("error", err => reject(new Error(`update_check_failed:${(err as Error).message}`)))
    req.end()
  })
}

type PreparedRelease = {
  rootDir: string
  extractedRoot: string
  tarballPath: string
  tarballSha256: string
  tarballBytes: number
  tarballFinalUrl: string | null
}

function stageReleaseDir(
  install: UpdateStatus["install"],
  release: UpdateCheckResult["latestRelease"],
  operationId: string,
  prefix: string,
): PreparedRelease {
  mkdirSync(install.versionsDir, { recursive: true })
  const rootDir = mkdtempSync(join(install.versionsDir, `${prefix}-${operationId}-`))
  const tarballPath = join(rootDir, `${release.version}.tar.gz`)
  const extractDir = join(rootDir, "extract")
  mkdirSync(extractDir, { recursive: true })
  return {
    rootDir,
    extractedRoot: extractDir,
    tarballPath,
    tarballSha256: "",
    tarballBytes: 0,
    tarballFinalUrl: null,
  }
}

function stageReleaseDryRun(
  install: UpdateStatus["install"],
  release: UpdateCheckResult["latestRelease"],
  operationId: string,
): PreparedRelease {
  return stageReleaseDir(install, release, operationId, ".dry-run")
}

function writeTarball(prepared: PreparedRelease, body: Buffer, finalUrl: string): PreparedRelease {
  const tarballSha256 = createHash("sha256").update(body).digest("hex")
  if (EXPECTED_TARBALL_SHA256 && tarballSha256.toLowerCase() !== EXPECTED_TARBALL_SHA256.toLowerCase()) {
    throw new Error(`update_validate_failed:tarball_sha256_mismatch:${tarballSha256}`)
  }
  writeFileSync(prepared.tarballPath, body)
  return {
    ...prepared,
    tarballBytes: body.byteLength,
    tarballSha256,
    tarballFinalUrl: finalUrl,
  }
}

function extractTarball(prepared: PreparedRelease): string {
  const result = spawnSync("tar", ["-xzf", prepared.tarballPath, "-C", prepared.extractedRoot], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`update_extract_failed:${result.stderr.trim() || result.stdout.trim() || "tar failed"}`)
  }
  const entries = readdirSync(prepared.extractedRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (entries.length !== 1) throw new Error("update_extract_failed:unexpected_tarball_layout")
  return join(prepared.extractedRoot, entries[0]!.name)
}

function validateExtractedRelease(root: string, release: UpdateCheckResult["latestRelease"]): { binPath: string } {
  const rootPackagePath = join(root, "package.json")
  const enginePackagePath = join(root, "apps", "engine", "package.json")
  const uiDir = join(root, "apps", "ui")
  if (!existsSync(rootPackagePath)) throw new Error("update_validate_failed:missing_root_package_json")
  if (!existsSync(enginePackagePath)) throw new Error("update_validate_failed:missing_engine_package_json")
  if (!existsSync(uiDir)) throw new Error("update_validate_failed:missing_apps_ui")
  const rootPackage = safeReadJson<{ workspaces?: unknown }>(rootPackagePath)
  if (!rootPackage) throw new Error("update_validate_failed:invalid_root_package_json")
  const enginePackage = safeReadJson<{ version?: unknown; bin?: unknown }>(enginePackagePath)
  if (!enginePackage) throw new Error("update_validate_failed:invalid_engine_package_json")
  const version = typeof enginePackage.version === "string" ? enginePackage.version.trim() : ""
  if (version !== release.version) {
    throw new Error(`tag-version-mismatch:${release.tag}:${version || "missing"}`)
  }
  const bin = typeof enginePackage.bin === "object" && enginePackage.bin && "beerengineer" in enginePackage.bin
    ? (enginePackage.bin as Record<string, unknown>).beerengineer
    : null
  if (typeof bin !== "string" || !bin.trim()) throw new Error("update_validate_failed:missing_engine_bin")
  const binPath = join(root, "apps", "engine", bin.replace(/^\.\//, ""))
  if (!existsSync(binPath)) throw new Error("update_validate_failed:engine_bin_missing")
  return { binPath }
}

function installStagedRelease(root: string): void {
  const result = spawnSync(resolveNpmCommandForPlatform(), ["install"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`update_install_failed:${result.stderr.trim() || result.stdout.trim() || "npm install failed"}`)
  }
}

function writePreparedSwitcher(
  install: UpdateStatus["install"],
  input: {
    operationId: string
    currentVersion: string
    targetRelease: UpdateCheckResult["latestRelease"]
    stagedRoot: string
    db: ResolvedDbPathInfo
    appConfig: Pick<AppConfig, "dataDir" | "enginePort">
  },
): { switcherPath: string; metadataPath: string } {
  mkdirSync(install.switcherDir, { recursive: true })
  const scriptExt = resolveSwitcherScriptExtension()
  const scriptPath = join(install.switcherDir, `${input.operationId}.${scriptExt}`)
  const metadataPath = join(install.switcherDir, `${input.operationId}.json`)
  writeFileSync(metadataPath, `${JSON.stringify({
    operationId: input.operationId,
    currentVersion: input.currentVersion,
    targetVersion: input.targetRelease.version,
    targetTag: input.targetRelease.tag,
    stagedRoot: input.stagedRoot,
    dbPath: input.db.path,
    dbPathSource: input.db.source,
    install: {
      root: install.root,
      currentLink: join(input.appConfig.dataDir, "install", "current"),
      previousLink: join(input.appConfig.dataDir, "install", "previous"),
      wrapperPath: install.wrapperPath,
      switcherDir: install.switcherDir,
      backupRoot: install.backupRoot,
      logRoot: install.logRoot,
    },
    api: {
      enginePort: input.appConfig.enginePort,
      host: "127.0.0.1",
      apiTokenFile: resolveApiTokenFilePath(),
      pidFile: resolveEnginePidFilePath(),
    },
    requiredMigrationLevel: REQUIRED_MIGRATION_LEVEL,
    createdAt: new Date().toISOString(),
    status: "prepared",
    updateLockPath: updateLockPath(input.appConfig),
  }, null, 2)}\n`, "utf8")
  const switcherProgram = join(input.stagedRoot, "apps", "engine", "bin", "update-switcher.js")
  const scriptBody = process.platform === "win32"
    ? [
        "@echo off",
        `node "${switcherProgram}" "${metadataPath}"`,
      ].join("\r\n") + "\r\n"
    : [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `node "${switcherProgram}" "${metadataPath}"`,
      ].join("\n") + "\n"
  writeFileSync(scriptPath, scriptBody, { encoding: "utf8", mode: 0o755 })
  try {
    chmodSync(scriptPath, 0o755)
  } catch {}
  return { switcherPath: scriptPath, metadataPath }
}

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

export async function runUpdateDryRun(
  repos: Repos,
  config: AppConfig,
  opts: { version?: string; allowLegacyDbShadow?: boolean } = {},
): Promise<UpdateDryRunResult> {
  const status = buildUpdateStatus(repos, config)
  const operationId = randomUUID()
  const warnings = [...status.warnings]
  const stages: UpdateDryRunStage[] = []
  let reclaimedLock = false
  let targetRelease: UpdateCheckResult["latestRelease"] | null = null
  let prepared: PreparedRelease | null = null

  const fail = (name: UpdateDryRunStage["name"], err: Error): UpdateDryRunResult => {
    stages.push({ name, status: "fail", detail: err.message })
    if (prepared) rmSync(prepared.rootDir, { recursive: true, force: true })
    repos.upsertUpdateAttempt({
      operationId,
      kind: "dry-run",
      status: "failed",
      fromVersion: status.currentVersion,
      targetVersion: targetRelease?.version ?? opts.version ?? null,
      dbPath: status.dbPath,
      dbPathSource: status.dbPathSource,
      legacyDbShadow: Boolean(legacyShadowWarning(status)),
      installRoot: status.install.root,
      errorMessage: err.message,
      metadataJson: JSON.stringify({
        stages,
        reclaimedLock,
        githubRepo: status.githubRepo,
        tarballSha256: prepared?.tarballSha256 ?? null,
        tarballBytes: prepared?.tarballBytes ?? null,
        tarballFinalUrl: prepared?.tarballFinalUrl ?? null,
      }),
      completedAt: Date.now(),
    })
    return {
      operationId,
      kind: "dry-run",
      status: "failed",
      currentVersion: status.currentVersion,
      targetRelease: targetRelease ?? {
        tag: opts.version?.startsWith("v") ? opts.version : `v${opts.version ?? status.currentVersion}`,
        version: normalizeReleaseTag(opts.version ?? status.currentVersion),
        publishedAt: null,
        tarballUrl: "",
        url: "",
      },
      githubRepo: status.githubRepo,
      stages,
      reclaimedLock,
      warnings,
    }
  }

  try {
    assertUpdateSafety(status, opts.allowLegacyDbShadow)
    stages.push({ name: "preflight", status: "pass", detail: "engine is idle and no active update lock blocks the run" })

    const check = await runUpdateCheck(config, { bypassCache: true, version: opts.version })
    targetRelease = check.latestRelease
    stages.push({ name: "release", status: "pass", detail: `resolved ${targetRelease.tag} from ${check.githubRepo}` })

    const lock = acquireUpdateLock(config, { operationId })
    reclaimedLock = lock.reclaimed
    if (lock.reclaimed) warnings.push("stale-update-lock-reclaimed")
    stages.push({
      name: "lock",
      status: "pass",
      detail: lock.reclaimed
        ? `reclaimed stale update lock from ${lock.reclaimedFrom?.operationId ?? "unknown operation"}`
        : "acquired update lock",
    })

    try {
      for (const dir of [status.install.backupRoot, status.install.logRoot, status.install.switcherDir, status.install.versionsDir]) {
        mkdirSync(dir, { recursive: true })
      }
      prepared = stageReleaseDryRun(status.install, targetRelease, operationId)
      const tarball = await requestBuffer(targetRelease.tarballUrl)
      const downloaded = writeTarball(prepared, tarball.body, tarball.finalUrl)
      prepared = downloaded
      stages.push({
        name: "download",
        status: "pass",
        detail: `downloaded ${downloaded.tarballBytes} bytes from GitHub source tarball`,
      })

      const extractedRoot = extractTarball(downloaded)
      stages.push({ name: "unpack", status: "pass", detail: `unpacked release into ${extractedRoot}` })

      const validation = validateExtractedRelease(extractedRoot, targetRelease)
      stages.push({ name: "validate", status: "pass", detail: `validated release structure and bin ${validation.binPath}` })

      installStagedRelease(extractedRoot)
      stages.push({ name: "install", status: "pass", detail: "npm install completed in the staged release" })

      const probePath = join(status.install.backupRoot, `.write-probe-${operationId}`)
      writeFileSync(probePath, "ok\n", "utf8")
      unlinkSync(probePath)
      stages.push({ name: "filesystem", status: "pass", detail: "managed update directories are writable" })

      const switcherPath = join(status.install.switcherDir, `${operationId}.${resolveSwitcherScriptExtension()}`)
      writeFileSync(
        switcherPath,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          `# Dry-run probe generated for ${operationId}.`,
          "# Detached install swap is not shipped yet.",
        ].join("\n") + "\n",
        "utf8",
      )
      unlinkSync(switcherPath)
      stages.push({ name: "switcher", status: "pass", detail: "switcher script path is writable" })
    } finally {
      if (prepared) rmSync(prepared.rootDir, { recursive: true, force: true })
      releaseUpdateLock(config, operationId)
    }

    repos.upsertUpdateAttempt({
      operationId,
      kind: "dry-run",
      status: "aborted-dry-run",
      fromVersion: status.currentVersion,
      targetVersion: targetRelease.version,
      dbPath: status.dbPath,
      dbPathSource: status.dbPathSource,
      legacyDbShadow: Boolean(legacyShadowWarning(status)),
      installRoot: status.install.root,
      metadataJson: JSON.stringify({
        stages,
        reclaimedLock,
        githubRepo: status.githubRepo,
        tarballSha256: prepared?.tarballSha256 ?? null,
        tarballBytes: prepared?.tarballBytes ?? null,
        tarballFinalUrl: prepared?.tarballFinalUrl ?? null,
      }),
      completedAt: Date.now(),
    })
    return {
      operationId,
      kind: "dry-run",
      status: "aborted-dry-run",
      currentVersion: status.currentVersion,
      targetRelease,
      githubRepo: status.githubRepo,
      stages,
      reclaimedLock,
      warnings,
    }
  } catch (err) {
    return fail(stages[stages.length - 1]?.name ?? "preflight", err as Error)
  }
}

export async function prepareUpdateApply(
  repos: Repos,
  config: AppConfig,
  opts: { version?: string; allowLegacyDbShadow?: boolean; idempotencyKey?: string } = {},
): Promise<UpdateApplyResult> {
  const status = buildUpdateStatus(repos, config)
  const operationId = randomUUID()
  assertUpdateSafety(status, opts.allowLegacyDbShadow)

  const check = await runUpdateCheck(config, { bypassCache: true, version: opts.version })
  const lock = acquireUpdateLock(config, { operationId })
  const warnings = [...status.warnings]
  if (lock.reclaimed) warnings.push("stale-update-lock-reclaimed")

  let prepared: PreparedRelease | null = null
  try {
    prepared = stageReleaseDir(status.install, check.latestRelease, operationId, ".staging")
    {
      const tarball = await requestBuffer(check.latestRelease.tarballUrl)
      prepared = writeTarball(prepared, tarball.body, tarball.finalUrl)
    }
    const extractedRoot = extractTarball(prepared)
    validateExtractedRelease(extractedRoot, check.latestRelease)
    installStagedRelease(extractedRoot)
    const switcher = writePreparedSwitcher(status.install, {
      operationId,
      currentVersion: status.currentVersion,
      targetRelease: check.latestRelease,
      stagedRoot: extractedRoot,
      db: resolveDbPathInfo(),
      appConfig: config,
    })
    repos.upsertUpdateAttempt({
      operationId,
      idempotencyKey: opts.idempotencyKey,
      kind: "apply",
      status: "queued",
      fromVersion: status.currentVersion,
      targetVersion: check.latestRelease.version,
      dbPath: status.dbPath,
      dbPathSource: status.dbPathSource,
      legacyDbShadow: Boolean(legacyShadowWarning(status)),
      installRoot: status.install.root,
      metadataJson: JSON.stringify({
        githubRepo: check.githubRepo,
        targetRelease: check.latestRelease,
        warnings,
        stagedRoot: extractedRoot,
        switcherPath: switcher.switcherPath,
        metadataPath: switcher.metadataPath,
        tarballSha256: prepared.tarballSha256,
        tarballBytes: prepared.tarballBytes,
        tarballFinalUrl: prepared.tarballFinalUrl,
        updateLockPath: updateLockPath(config),
      }),
    })
    return {
      operationId,
      state: "queued",
      currentVersion: status.currentVersion,
      targetRelease: check.latestRelease,
      githubRepo: check.githubRepo,
      stagedRoot: extractedRoot,
      switcherPath: switcher.switcherPath,
      metadataPath: switcher.metadataPath,
      warnings,
    }
  } catch (err) {
    if (prepared) rmSync(prepared.rootDir, { recursive: true, force: true })
    releaseUpdateLock(config, operationId)
    repos.upsertUpdateAttempt({
      operationId,
      idempotencyKey: opts.idempotencyKey,
      kind: "apply",
      status: "failed-no-rollback",
      fromVersion: status.currentVersion,
      targetVersion: opts.version ?? null,
      dbPath: status.dbPath,
      dbPathSource: status.dbPathSource,
      legacyDbShadow: Boolean(legacyShadowWarning(status)),
      installRoot: status.install.root,
      errorMessage: (err as Error).message,
      completedAt: Date.now(),
    })
    throw err
  }
}

export function markPreparedUpdateInFlight(
  repos: Repos,
  operationId: string,
): UpdateHistoryEntry | null {
  const existing = repos.getUpdateAttempt(operationId)
  if (!existing || existing.status !== "queued") return null
  const row = repos.upsertUpdateAttempt({
    operationId,
    kind: existing.kind,
    status: "in-flight",
    fromVersion: existing.from_version,
    targetVersion: existing.target_version,
    dbPath: existing.db_path,
    dbPathSource: existing.db_path_source,
    legacyDbShadow: existing.legacy_db_shadow === 1,
    installRoot: existing.install_root,
    backupDir: existing.backup_dir,
    errorMessage: existing.error_message,
    metadataJson: existing.metadata_json,
  })
  return historyPayload(row)
}

export function listUpdateHistory(repos: Repos, limit = 20): UpdateHistoryEntry[] {
  return repos.listUpdateAttempts(limit).map(historyPayload)
}

export function listBackupHistory(config: Pick<AppConfig, "dataDir">, limit = 20): DatabaseBackupRecord[] {
  return listDatabaseBackups(resolveManagedInstallPaths(config).backupRoot, limit)
}

function requestJson<T>(urlString: string): Promise<T> {
  return requestBuffer(urlString).then(({ body }) => {
    try {
      return JSON.parse(body.toString("utf8")) as T
    } catch {
      throw new Error("update_check_failed:invalid_github_payload")
    }
  })
}

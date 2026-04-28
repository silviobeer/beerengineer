import { chmodSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { resolveApiTokenFilePath } from "../../api/tokenFile.js"
import { resolveEnginePidFilePath } from "../../api/pidFile.js"
import { resolveDbPathInfo } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import { REQUIRED_MIGRATION_LEVEL } from "../../setup/config.js"
import type { AppConfig } from "../../setup/types.js"
import { legacyShadowWarning } from "./attempts.js"
import { acquireUpdateLock, releaseUpdateLock, updateLockPath } from "./lock.js"
import {
  extractTarball,
  installStagedRelease,
  requestBuffer,
  runUpdateCheck,
  stageReleaseDir,
  stageReleaseDryRun,
  validateExtractedRelease,
  writeTarball,
  type PreparedRelease,
} from "./release.js"
import { normalizeReleaseTag, resolveSwitcherScriptExtension } from "./shared.js"
import { assertUpdateSafety, buildUpdateStatus } from "./status.js"
import type { UpdateApplyResult, UpdateCheckResult, UpdateDryRunResult, UpdateDryRunStage, UpdateStatus } from "./types.js"

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
      writeFileSync(switcherPath, [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `# Dry-run probe generated for ${operationId}.`,
        "# Detached install swap is not shipped yet.",
      ].join("\n") + "\n", "utf8")
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
    return fail(stages.at(-1)?.name ?? "preflight", err as Error)
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
    const tarball = await requestBuffer(check.latestRelease.tarballUrl)
    prepared = writeTarball(prepared, tarball.body, tarball.finalUrl)
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

function writePreparedSwitcher(
  install: UpdateStatus["install"],
  input: {
    operationId: string
    currentVersion: string
    targetRelease: UpdateCheckResult["latestRelease"]
    stagedRoot: string
    db: ReturnType<typeof resolveDbPathInfo>
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

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { AppConfig } from "../../setup/types.js"
import {
  acquireManagedInstallUpdateLock,
  managedInstallUpdateLockPath,
  releaseUpdateLock,
} from "../updateMode/lock.js"
import {
  normalizeReleaseTag,
  resolveManagedInstallPaths,
  resolveManagedInstallWrapperPath,
} from "../updateMode/shared.js"
import { validateManagedInstallReleaseTree } from "./validation.js"

export type ManagedInstallVersionRef = {
  tag: string
  version: string
}

export type ManagedInstallStatePaths = {
  dataDir: string
  installRoot: string
  versionsDir: string
  currentLinkPath: string
  currentTargetPath: string | null
  binDir: string
  wrapperPath: string
  lockPath: string
}

export type ManagedInstallRepair = {
  kind: "created-current" | "created-wrapper"
  path: string
  target?: string
  message: string
}

export type ManagedInstallStateEvaluation = {
  status: "missing" | "adoptable" | "repairable" | "already-installed" | "hard-stop"
  reason: string
  paths: ManagedInstallStatePaths
  activeVersion: string | null
  currentTargetPath: string | null
  candidateVersions: Array<{ tag: string; version: string; path: string }>
  preservedAppData: {
    configFiles: string[]
    sqliteFiles: string[]
    devCheckoutArtifacts: string[]
  }
  repairs: ManagedInstallRepair[]
  stop?: {
    code: "ambiguous_versions_without_current" | "invalid_current"
    path: string
    message: string
    fixHint: string
  }
}

export type ManagedInstallActivationResult = {
  versionPath: string
  currentPath: string
  wrapperPath: string
  actions: ManagedInstallRepair[]
}

export function resolveManagedInstallStatePaths(
  config: Pick<AppConfig, "dataDir">,
  opts: { platform?: NodeJS.Platform } = {},
): ManagedInstallStatePaths {
  const install = resolveManagedInstallPaths(config, opts)
  const wrapperPath = resolveManagedInstallWrapperPath(config, opts.platform)
  return {
    dataDir: config.dataDir,
    installRoot: install.root,
    versionsDir: install.versionsDir,
    currentLinkPath: join(install.root, "current"),
    currentTargetPath: install.currentPath,
    binDir: dirname(wrapperPath),
    wrapperPath,
    lockPath: managedInstallUpdateLockPath(config),
  }
}

export function activateManagedInstallVersion(
  config: Pick<AppConfig, "dataDir">,
  release: ManagedInstallVersionRef,
  opts: { platform?: NodeJS.Platform } = {},
): ManagedInstallActivationResult {
  const paths = resolveManagedInstallStatePaths(config, opts)
  const versionPath = join(paths.versionsDir, safeReleaseTag(release.tag))
  mkdirSync(versionPath, { recursive: true })
  pointCurrent(paths.currentLinkPath, versionPath, opts.platform)
  const wrapper = writeManagedInstallWrapper(paths, opts.platform)
  return {
    versionPath,
    currentPath: paths.currentLinkPath,
    wrapperPath: paths.wrapperPath,
    actions: [
      {
        kind: "created-current",
        path: paths.currentLinkPath,
        target: versionPath,
        message: `Activated ${release.tag} at ${paths.currentLinkPath}`,
      },
      wrapper,
    ],
  }
}

export function activateManagedInstallVersionWithLock(
  config: Pick<AppConfig, "dataDir">,
  release: ManagedInstallVersionRef,
  opts: { operationId?: string; platform?: NodeJS.Platform } = {},
): ManagedInstallActivationResult {
  const lock = acquireManagedInstallUpdateLock(config, { operationId: opts.operationId })
  try {
    return activateManagedInstallVersion(config, release, opts)
  } finally {
    releaseUpdateLock(config, lock.record.operationId)
  }
}

export function evaluateManagedInstallState(
  config: Pick<AppConfig, "dataDir">,
  opts: { platform?: NodeJS.Platform } = {},
): ManagedInstallStateEvaluation {
  const paths = resolveManagedInstallStatePaths(config, opts)
  const preservedAppData = readPreservedAppData(config.dataDir)
  const candidateVersions = listValidVersionCandidates(paths.versionsDir)
  const currentTargetPath = readCurrentTarget(paths.currentLinkPath)
  const wrapperExists = existsSync(paths.wrapperPath)

  if (existsSync(paths.currentLinkPath)) {
    const active = currentTargetPath ? readValidActiveVersion(currentTargetPath) : null
    if (!active) {
      return {
        status: "hard-stop",
        reason: "invalid-current",
        paths,
        activeVersion: null,
        currentTargetPath,
        candidateVersions,
        preservedAppData,
        repairs: [],
        stop: {
          code: "invalid_current",
          path: paths.currentLinkPath,
          message: `Managed install current state at ${paths.currentLinkPath} points to an invalid release shape.`,
          fixHint: `Manually inspect ${paths.currentLinkPath} and ${paths.versionsDir} before rerunning the installer.`,
        },
      }
    }
    if (!wrapperExists) {
      return evaluation({
        status: "repairable",
        reason: "missing-wrapper",
        paths,
        activeVersion: active.version,
        currentTargetPath,
        candidateVersions,
        preservedAppData,
        repairs: [{
          kind: "created-wrapper",
          path: paths.wrapperPath,
          message: `Recreate missing managed wrapper at ${paths.wrapperPath}.`,
        }],
      })
    }
    return evaluation({
      status: "already-installed",
      reason: "valid-current-and-wrapper",
      paths,
      activeVersion: active.version,
      currentTargetPath,
      candidateVersions,
      preservedAppData,
      repairs: [],
    })
  }

  if (candidateVersions.length === 1) {
    const version = candidateVersions[0]
    return evaluation({
      status: "repairable",
      reason: "missing-current",
      paths,
      activeVersion: null,
      currentTargetPath: null,
      candidateVersions,
      preservedAppData,
      repairs: [
        {
          kind: "created-current",
          path: paths.currentLinkPath,
          target: version.path,
          message: `Recreate missing current pointer to ${version.path}.`,
        },
        ...(wrapperExists ? [] : [{
          kind: "created-wrapper" as const,
          path: paths.wrapperPath,
          message: `Recreate missing managed wrapper at ${paths.wrapperPath}.`,
        }]),
      ],
    })
  }

  if (candidateVersions.length > 1) {
    return {
      status: "hard-stop",
      reason: "ambiguous-versions-without-current",
      paths,
      activeVersion: null,
      currentTargetPath: null,
      candidateVersions,
      preservedAppData,
      repairs: [],
      stop: {
        code: "ambiguous_versions_without_current",
        path: paths.versionsDir,
        message: `Multiple valid managed versions exist under ${paths.versionsDir} without an active current state.`,
        fixHint: `Manually choose the intended version and repair ${paths.currentLinkPath} before rerunning the installer.`,
      },
    }
  }

  return evaluation({
    status: hasPreservedAppData(preservedAppData) ? "adoptable" : "missing",
    reason: hasPreservedAppData(preservedAppData) ? "app-data-without-managed-install" : "no-managed-install",
    paths,
    activeVersion: null,
    currentTargetPath: null,
    candidateVersions,
    preservedAppData,
    repairs: [],
  })
}

export function repairManagedInstallState(
  config: Pick<AppConfig, "dataDir">,
  opts: { platform?: NodeJS.Platform } = {},
): ManagedInstallStateEvaluation {
  const before = evaluateManagedInstallState(config, opts)
  if (before.status === "hard-stop") {
    throw new Error(`managed_install_state_hard_stop:${before.stop?.code ?? "unknown"}:${before.stop?.path ?? before.paths.installRoot}`)
  }
  const applied: ManagedInstallRepair[] = []
  if (before.status === "repairable") {
    for (const repair of before.repairs) {
      if (repair.kind === "created-current" && repair.target) {
        pointCurrent(before.paths.currentLinkPath, repair.target, opts.platform)
        applied.push(repair)
      }
      if (repair.kind === "created-wrapper") {
        applied.push(writeManagedInstallWrapper(before.paths, opts.platform))
      }
    }
  }
  return {
    ...evaluateManagedInstallState(config, opts),
    repairs: applied,
  }
}

function evaluation(input: ManagedInstallStateEvaluation): ManagedInstallStateEvaluation {
  return input
}

function writeManagedInstallWrapper(
  paths: ManagedInstallStatePaths,
  platform: NodeJS.Platform = process.platform,
): ManagedInstallRepair {
  mkdirSync(paths.binDir, { recursive: true })
  const engineBin = platform === "win32"
    ? join(paths.currentLinkPath, "apps", "engine", "bin", "beerengineer.js").replaceAll("/", "\\")
    : join(paths.currentLinkPath, "apps", "engine", "bin", "beerengineer.js")
  const body = platform === "win32"
    ? [
        "@echo off",
        `node "${engineBin}" %*`,
      ].join("\r\n") + "\r\n"
    : [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `exec node "${engineBin}" "$@"`,
      ].join("\n") + "\n"
  writeFileSync(paths.wrapperPath, body, { encoding: "utf8", mode: 0o755 })
  try {
    chmodSync(paths.wrapperPath, 0o755)
  } catch {}
  return {
    kind: "created-wrapper",
    path: paths.wrapperPath,
    message: `Created managed wrapper at ${paths.wrapperPath}.`,
  }
}

function pointCurrent(
  currentLinkPath: string,
  versionPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  mkdirSync(dirname(currentLinkPath), { recursive: true })
  rmSync(currentLinkPath, { recursive: true, force: true })
  symlinkSync(versionPath, currentLinkPath, platform === "win32" ? "junction" : "dir")
}

function readCurrentTarget(currentLinkPath: string): string | null {
  try {
    if (!existsSync(currentLinkPath)) return null
    const stat = lstatSync(currentLinkPath)
    if (stat.isSymbolicLink() || stat.isDirectory()) return realpathSync(currentLinkPath)
    return currentLinkPath
  } catch {
    return null
  }
}

function listValidVersionCandidates(versionsDir: string): Array<{ tag: string; version: string; path: string }> {
  if (!existsSync(versionsDir)) return []
  return readdirSync(versionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => {
      const path = join(versionsDir, entry.name)
      const version = normalizeReleaseTag(entry.name)
      try {
        validateManagedInstallReleaseTree(path, { tag: entry.name, version })
        return { tag: entry.name, version, path }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { tag: string; version: string; path: string } => entry !== null)
}

function readValidActiveVersion(path: string): { version: string } | null {
  const version = readEnginePackageVersion(path)
  if (!version) return null
  try {
    validateManagedInstallReleaseTree(path, { tag: `v${version}`, version })
    return { version }
  } catch {
    return null
  }
}

function readEnginePackageVersion(root: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "apps", "engine", "package.json"), "utf8")) as { version?: unknown }
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null
  } catch {
    return null
  }
}

function readPreservedAppData(dataDir: string): ManagedInstallStateEvaluation["preservedAppData"] {
  if (!existsSync(dataDir)) return { configFiles: [], sqliteFiles: [], devCheckoutArtifacts: [] }
  const entries = readdirSync(dataDir, { withFileTypes: true })
  const configFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".json") && entry.name.toLowerCase().includes("config"))
    .map(entry => join(dataDir, entry.name))
    .sort()
  const sqliteFiles = entries
    .filter(entry => entry.isFile() && /\.(sqlite|sqlite3|db)$/i.test(entry.name))
    .map(entry => join(dataDir, entry.name))
    .sort()
  const devCheckoutArtifacts = entries
    .filter(entry => entry.isDirectory() && existsSync(join(dataDir, entry.name, "package.json")))
    .map(entry => join(dataDir, entry.name))
    .filter(path => !path.startsWith(resolve(dataDir, "install")))
    .sort()
  return { configFiles, sqliteFiles, devCheckoutArtifacts }
}

function hasPreservedAppData(appData: ManagedInstallStateEvaluation["preservedAppData"]): boolean {
  return appData.configFiles.length > 0 || appData.sqliteFiles.length > 0
}

function safeReleaseTag(tag: string): string {
  const trimmed = tag.trim()
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("managed_install_state_failed:invalid_release_tag")
  }
  return trimmed
}

export function managedInstallPathExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

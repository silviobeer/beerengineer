import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"

export type ManagedInstallReleaseValidationLimits = {
  maxTarballBytes: number
  maxExtractedBytes: number
}

export const DEFAULT_MANAGED_INSTALL_VALIDATION_LIMITS: ManagedInstallReleaseValidationLimits = {
  maxTarballBytes: 250 * 1024 * 1024,
  maxExtractedBytes: 750 * 1024 * 1024,
}

type ReleaseVersion = {
  tag: string
  version: string
}

export function validateManagedInstallArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    if (archiveEntryIsUnsafe(entry)) {
      throw new Error("managed_install_validate_failed:unsafe_archive_entry")
    }
  }
}

export function validateManagedInstallReleaseSizes(
  actual: { tarballBytes: number; extractedBytes: number },
  limits: ManagedInstallReleaseValidationLimits = DEFAULT_MANAGED_INSTALL_VALIDATION_LIMITS,
): void {
  if (actual.tarballBytes > limits.maxTarballBytes) {
    throw new Error(`managed_install_validate_failed:tarball_too_large:${actual.tarballBytes}:${limits.maxTarballBytes}`)
  }
  if (actual.extractedBytes > limits.maxExtractedBytes) {
    throw new Error(`managed_install_validate_failed:extracted_tree_too_large:${actual.extractedBytes}:${limits.maxExtractedBytes}`)
  }
}

export function validateManagedInstallReleaseTree(root: string, release: ReleaseVersion): { binPath: string } {
  const rootPackagePath = join(root, "package.json")
  const engineDir = join(root, "apps", "engine")
  const enginePackagePath = join(engineDir, "package.json")
  const uiDir = join(root, "apps", "ui")
  if (!existsSync(rootPackagePath)) throw new Error("managed_install_validate_failed:missing_root_package_json")
  if (!existsSync(enginePackagePath)) throw new Error("managed_install_validate_failed:missing_engine_package_json")
  if (!existsSync(uiDir)) throw new Error("managed_install_validate_failed:missing_apps_ui")

  const rootPackage = readJson<{ workspaces?: unknown }>(rootPackagePath)
  const workspaces = normalizeWorkspaces(rootPackage.workspaces)
  if (!workspaceIncludes(workspaces, "apps/engine")) throw new Error("managed_install_validate_failed:missing_workspace_apps_engine")
  if (!workspaceIncludes(workspaces, "apps/ui")) throw new Error("managed_install_validate_failed:missing_workspace_apps_ui")

  const enginePackage = readJson<{ name?: unknown; version?: unknown; bin?: unknown }>(enginePackagePath)
  if (enginePackage.name !== "@beerengineer/engine") throw new Error("managed_install_validate_failed:unexpected_engine_package_name")
  const engineVersion = typeof enginePackage.version === "string" && enginePackage.version.trim()
    ? enginePackage.version.trim()
    : "missing"
  if (engineVersion !== release.version) {
    throw new Error(`managed_install_validate_failed:tag_version_mismatch:${release.tag}:${engineVersion}`)
  }
  const bin = typeof enginePackage.bin === "object" && enginePackage.bin && "beerengineer" in enginePackage.bin
    ? (enginePackage.bin as Record<string, unknown>).beerengineer
    : null
  if (typeof bin !== "string" || !bin.trim()) throw new Error("managed_install_validate_failed:missing_engine_bin")
  const engineRoot = resolve(engineDir)
  const binPath = resolve(engineRoot, bin.replace(/^\.\//, ""))
  if (binPath !== engineRoot && !binPath.startsWith(`${engineRoot}${sep}`)) {
    throw new Error("managed_install_validate_failed:engine_bin_missing")
  }
  if (!existsSync(binPath)) throw new Error("managed_install_validate_failed:engine_bin_missing")
  return { binPath }
}

export function listManagedInstallTarballEntries(tarballPath: string): string[] {
  const result = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`managed_install_validate_failed:tar_list_failed:${result.stderr.trim() || result.stdout.trim() || "tar failed"}`)
  }
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

export function measureDirectoryBytes(root: string): number {
  let total = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      total += measureDirectoryBytes(path)
    } else if (entry.isFile()) {
      total += statSync(path).size
    }
  }
  return total
}

function archiveEntryIsUnsafe(entry: string): boolean {
  const normalized = entry.trim().replaceAll("\\", "/")
  if (!normalized) return true
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return true
  return normalized.split("/").some(part => part === "..")
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    throw new Error(`managed_install_validate_failed:invalid_json:${path}`)
  }
}

function normalizeWorkspaces(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string")
  if (typeof raw === "object" && raw && Array.isArray((raw as { packages?: unknown }).packages)) {
    return (raw as { packages: unknown[] }).packages.filter((entry): entry is string => typeof entry === "string")
  }
  return []
}

function workspaceIncludes(workspaces: string[], path: "apps/engine" | "apps/ui"): boolean {
  return workspaces.some(workspace => {
    const normalized = workspace.replace(/\/$/, "")
    if (normalized === path) return true
    if (!normalized.endsWith("/*")) return false
    const prefix = normalized.slice(0, -2)
    return path.startsWith(`${prefix}/`) && path.slice(prefix.length + 1).split("/").length === 1
  })
}

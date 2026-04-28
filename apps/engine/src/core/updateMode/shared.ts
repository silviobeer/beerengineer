import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { AppConfig } from "../../setup/types.js"
import type { UpdateStatus } from "./types.js"

const ENGINE_PACKAGE_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json")
const DEFAULT_GITHUB_REPO = process.env.BEERENGINEER_UPDATE_GITHUB_REPO?.trim() || "silviobeer/beerengineer"

let cachedVersion: string | null = null

export function resolveNpmCommandForPlatform(platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm"
}

export function resolveSwitcherScriptExtension(platform = process.platform): "cmd" | "sh" {
  return platform === "win32" ? "cmd" : "sh"
}

export function safeReadJson<T>(path: string): T | null {
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

export function normalizeReleaseTag(tag: string): string {
  return tag.trim().replace(/^v/i, "")
}

export function compareVersions(a: string, b: string): number {
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

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
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

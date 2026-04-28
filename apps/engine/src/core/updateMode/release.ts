import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { URL } from "node:url"
import type { AppConfig } from "../../setup/types.js"
import {
  compareVersions,
  currentAppVersion,
  normalizeReleaseTag,
  resolveGithubRepo,
  resolveNpmCommandForPlatform,
  safeReadJson,
} from "./shared.js"
import type { UpdateCheckResult, UpdateStatus } from "./types.js"

type ReleasePayload = {
  tag_name?: unknown
  tarball_url?: unknown
  html_url?: unknown
  published_at?: unknown
}

export type PreparedRelease = {
  rootDir: string
  extractedRoot: string
  tarballPath: string
  tarballSha256: string
  tarballBytes: number
  tarballFinalUrl: string | null
}

const DEFAULT_GITHUB_API_BASE = process.env.BEERENGINEER_UPDATE_GITHUB_API_BASE_URL?.trim() || "https://api.github.com"
const EXPECTED_TARBALL_SHA256 = process.env.BEERENGINEER_UPDATE_EXPECTED_TARBALL_SHA256?.trim() || null
const RELEASE_CACHE_TTL_MS = 60_000

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

export async function requestBuffer(
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
    req.on("error", err => reject(new Error(`update_check_failed:${err.message}`)))
    req.end()
  })
}

export function stageReleaseDir(
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

export function stageReleaseDryRun(
  install: UpdateStatus["install"],
  release: UpdateCheckResult["latestRelease"],
  operationId: string,
): PreparedRelease {
  return stageReleaseDir(install, release, operationId, ".dry-run")
}

export function writeTarball(prepared: PreparedRelease, body: Buffer, finalUrl: string): PreparedRelease {
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

export function extractTarball(prepared: PreparedRelease): string {
  const result = spawnSync("tar", ["-xzf", prepared.tarballPath, "-C", prepared.extractedRoot], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`update_extract_failed:${result.stderr.trim() || result.stdout.trim() || "tar failed"}`)
  }
  const entries = readdirSync(prepared.extractedRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (entries.length !== 1) throw new Error("update_extract_failed:unexpected_tarball_layout")
  return join(prepared.extractedRoot, entries[0].name)
}

export function validateExtractedRelease(root: string, release: UpdateCheckResult["latestRelease"]): { binPath: string } {
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

export function installStagedRelease(root: string): void {
  const result = spawnSync(resolveNpmCommandForPlatform(), ["install"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`update_install_failed:${result.stderr.trim() || result.stdout.trim() || "npm install failed"}`)
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

function resolveGithubAuthToken(): string | null {
  const explicit = process.env.BEERENGINEER_GITHUB_TOKEN?.trim()
  if (explicit) return explicit
  const generic = process.env.GITHUB_TOKEN?.trim()
  if (generic) return generic
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

function requestJson<T>(urlString: string): Promise<T> {
  return requestBuffer(urlString).then(({ body }) => {
    try {
      return JSON.parse(body.toString("utf8")) as T
    } catch {
      throw new Error("update_check_failed:invalid_github_payload")
    }
  })
}

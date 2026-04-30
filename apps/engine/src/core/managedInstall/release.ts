import { URL } from "node:url"
import { normalizeReleaseTag, resolveGithubRepo } from "../updateMode/shared.js"
import type { ManagedInstallReleaseTarget } from "./types.js"

type GithubReleasePayload = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  tarball_url?: unknown
  html_url?: unknown
  published_at?: unknown
}

type ResolveManagedInstallReleaseOptions = {
  repo?: string
  apiBaseUrl?: string
  fetchTimeoutMs?: number
  fetchReleases?: (context: { repo: string; apiBaseUrl: string }) => Promise<unknown>
}

const DEFAULT_GITHUB_API_BASE = process.env.BEERENGINEER_INSTALL_GITHUB_API_BASE_URL?.trim() || "https://api.github.com"
const DEFAULT_RELEASE_FETCH_TIMEOUT_MS = 30_000

export async function resolveManagedInstallRelease(
  opts: ResolveManagedInstallReleaseOptions = {},
): Promise<ManagedInstallReleaseTarget> {
  const repo = opts.repo?.trim() || resolveGithubRepo()
  const apiBaseUrl = opts.apiBaseUrl?.trim() || DEFAULT_GITHUB_API_BASE
  const rawPayload = opts.fetchReleases
    ? await opts.fetchReleases({ repo, apiBaseUrl })
    : await fetchGithubReleases({
      repo,
      apiBaseUrl,
      timeoutMs: opts.fetchTimeoutMs ?? DEFAULT_RELEASE_FETCH_TIMEOUT_MS,
    })
  const payloads = coerceReleasePayloads(rawPayload)
  const stable = payloads
    .filter(payload => payload.draft !== true && payload.prerelease !== true)
    .sort(comparePublishedDescending)
  const selected = stable[0]
  if (!selected) throw new Error(`managed_install_release_required:no_stable_release:${repo}`)
  return releasePayloadToManagedTarget(repo, selected)
}

async function fetchGithubReleases(context: { repo: string; apiBaseUrl: string; timeoutMs: number }): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${context.apiBaseUrl.replace(/\/$/, "")}/repos/${context.repo}/releases`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "beerengineer-managed-install",
      },
      signal: AbortSignal.timeout(context.timeoutMs),
    })
  } catch (err) {
    if (isTimeoutError(err)) throw new Error("managed_install_release_resolution_failed:github_timeout")
    throw new Error(`managed_install_release_resolution_failed:${(err as Error).message}`)
  }
  if (!response.ok) throw new Error(`managed_install_release_resolution_failed:github_http_${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error("managed_install_release_resolution_failed:invalid_github_payload")
  }
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

function coerceReleasePayloads(raw: unknown): GithubReleasePayload[] {
  if (!Array.isArray(raw)) throw new Error("managed_install_release_resolution_failed:invalid_github_payload")
  return raw.filter((entry): entry is GithubReleasePayload => typeof entry === "object" && entry !== null)
}

function comparePublishedDescending(a: GithubReleasePayload, b: GithubReleasePayload): number {
  return publishedTime(b) - publishedTime(a)
}

function publishedTime(payload: GithubReleasePayload): number {
  if (payload.draft === true) return 0
  const publishedAt = typeof payload.published_at === "string" ? Date.parse(payload.published_at) : Number.NaN
  return Number.isFinite(publishedAt) ? publishedAt : 0
}

function releasePayloadToManagedTarget(repo: string, payload: GithubReleasePayload): ManagedInstallReleaseTarget {
  const tag = typeof payload.tag_name === "string" && payload.tag_name.trim() ? payload.tag_name.trim() : null
  const tarballUrl = typeof payload.tarball_url === "string" && payload.tarball_url.trim() ? payload.tarball_url.trim() : null
  const htmlUrl = typeof payload.html_url === "string" && payload.html_url.trim() ? payload.html_url.trim() : null
  if (!tag || !tarballUrl || !htmlUrl) {
    throw new Error("managed_install_release_resolution_failed:invalid_github_payload")
  }
  const downloadUrl = new URL(tarballUrl)
  if (downloadUrl.protocol !== "https:") {
    throw new Error(`managed_install_release_resolution_failed:insecure_tarball_protocol:${downloadUrl.protocol}`)
  }
  return {
    repo,
    tag,
    version: normalizeReleaseTag(tag),
    tarballUrl,
    htmlUrl,
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
    download: {
      tarballUrl,
      host: downloadUrl.hostname.toLowerCase(),
      protocol: "https:",
    },
  }
}

import { request as httpsRequest } from "node:https"
import { URL } from "node:url"
import { DEFAULT_MANAGED_INSTALL_VALIDATION_LIMITS } from "./validation.js"

export const TRUSTED_MANAGED_INSTALL_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
])

type ManagedInstallDownloadResponse = {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

type ManagedInstallDownloadRequest = (url: URL) => Promise<ManagedInstallDownloadResponse>

export type ManagedInstallDownloadResult = {
  body: Buffer
  finalUrl: string
}

const DEFAULT_DOWNLOAD_REQUEST_TIMEOUT_MS = 30_000

export function assertTrustedManagedInstallDownloadUrl(
  urlString: string,
  allowedHosts = TRUSTED_MANAGED_INSTALL_DOWNLOAD_HOSTS,
): URL {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error("managed_install_download_failed:invalid_url")
  }
  if (url.protocol !== "https:") {
    throw new Error(`managed_install_download_failed:unsupported_protocol:${url.protocol}`)
  }
  const host = url.hostname.toLowerCase()
  if (!allowedHosts.has(host)) throw new Error(`managed_install_download_failed:untrusted_host:${host}`)
  return url
}

export async function downloadManagedInstallTarball(
  urlString: string,
  opts: {
    maxRedirects?: number
    maxBytes?: number
    requestTimeoutMs?: number
    request?: ManagedInstallDownloadRequest
  } = {},
): Promise<ManagedInstallDownloadResult> {
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_DOWNLOAD_REQUEST_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MANAGED_INSTALL_VALIDATION_LIMITS.maxTarballBytes
  const request = opts.request ?? (url => requestHttpsBuffer(url, requestTimeoutMs, maxBytes))
  const maxRedirects = opts.maxRedirects ?? 5
  return await downloadTrustedUrl(
    assertTrustedManagedInstallDownloadUrl(urlString),
    request,
    maxRedirects,
    requestTimeoutMs,
    maxBytes,
  )
}

async function downloadTrustedUrl(
  url: URL,
  request: ManagedInstallDownloadRequest,
  remainingRedirects: number,
  requestTimeoutMs: number,
  maxBytes: number,
): Promise<ManagedInstallDownloadResult> {
  const response = await withRequestTimeout(request(url), requestTimeoutMs)
  assertResponseSize(response.body.byteLength, maxBytes)
  const location = response.headers.location
  if (response.statusCode >= 300 && response.statusCode < 400 && location) {
    if (remainingRedirects <= 0) throw new Error("managed_install_download_failed:too_many_redirects")
    const next = new URL(Array.isArray(location) ? location[0] ?? "" : location, url)
    try {
      assertTrustedManagedInstallDownloadUrl(next.toString())
    } catch (err) {
      throw redirectTrustError(err as Error)
    }
    return await downloadTrustedUrl(next, request, remainingRedirects - 1, requestTimeoutMs, maxBytes)
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`managed_install_download_failed:http_${response.statusCode}`)
  }
  return {
    body: response.body,
    finalUrl: url.toString(),
  }
}

function assertResponseSize(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new Error(`managed_install_download_failed:size_exceeded:${bytes}:${maxBytes}`)
  }
}

function withRequestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("managed_install_download_failed:timeout")), timeoutMs)
    promise
      .then(value => {
        clearTimeout(timer)
        resolvePromise(value)
      })
      .catch(err => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function redirectTrustError(err: Error): Error {
  return new Error(err.message
    .replace("managed_install_download_failed:untrusted_host:", "managed_install_download_failed:untrusted_redirect_host:"))
}

function requestHttpsBuffer(url: URL, timeoutMs: number, maxBytes: number): Promise<ManagedInstallDownloadResponse> {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let abortedOrErrored = false
    const rejectOnce = (err: Error): void => {
      if (settled) return
      settled = true
      abortedOrErrored = true
      reject(new Error(`managed_install_download_failed:${err.message}`))
    }
    const resolveOnce = (response: ManagedInstallDownloadResponse): void => {
      if (settled) return
      settled = true
      resolvePromise(response)
    }
    const req = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "application/octet-stream",
        "user-agent": "beerengineer-managed-install",
        connection: "close",
      },
    }, res => {
      const chunks: Buffer[] = []
      let totalBytes = 0
      res.on("data", chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buffer.byteLength
        if (totalBytes > maxBytes) {
          abortedOrErrored = true
          req.destroy(new Error(`size_exceeded:${totalBytes}:${maxBytes}`))
          return
        }
        chunks.push(buffer)
      })
      res.on("end", () => {
        if (abortedOrErrored) return
        resolveOnce({
          statusCode: res.statusCode ?? 500,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
      res.on("error", err => rejectOnce(err as Error))
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"))
    })
    req.on("error", err => rejectOnce(err))
    req.end()
  })
}

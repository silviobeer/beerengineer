import { request as httpsRequest } from "node:https"
import { URL } from "node:url"

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
    request?: ManagedInstallDownloadRequest
  } = {},
): Promise<ManagedInstallDownloadResult> {
  const request = opts.request ?? requestHttpsBuffer
  const maxRedirects = opts.maxRedirects ?? 5
  return await downloadTrustedUrl(assertTrustedManagedInstallDownloadUrl(urlString), request, maxRedirects)
}

async function downloadTrustedUrl(
  url: URL,
  request: ManagedInstallDownloadRequest,
  remainingRedirects: number,
): Promise<ManagedInstallDownloadResult> {
  const response = await request(url)
  const location = response.headers.location
  if (response.statusCode >= 300 && response.statusCode < 400 && location) {
    if (remainingRedirects <= 0) throw new Error("managed_install_download_failed:too_many_redirects")
    const next = new URL(Array.isArray(location) ? location[0] ?? "" : location, url)
    try {
      assertTrustedManagedInstallDownloadUrl(next.toString())
    } catch (err) {
      throw redirectTrustError(err as Error)
    }
    return await downloadTrustedUrl(next, request, remainingRedirects - 1)
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`managed_install_download_failed:http_${response.statusCode}`)
  }
  return {
    body: response.body,
    finalUrl: url.toString(),
  }
}

function redirectTrustError(err: Error): Error {
  return new Error(err.message
    .replace("managed_install_download_failed:untrusted_host:", "managed_install_download_failed:untrusted_redirect_host:"))
}

function requestHttpsBuffer(url: URL): Promise<ManagedInstallDownloadResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "application/octet-stream",
        "user-agent": "beerengineer-managed-install",
        connection: "close",
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on("end", () => resolvePromise({
        statusCode: res.statusCode ?? 500,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on("error", err => reject(new Error(`managed_install_download_failed:${err.message}`)))
    req.end()
  })
}

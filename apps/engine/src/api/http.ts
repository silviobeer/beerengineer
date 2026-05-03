import type { IncomingMessage, ServerResponse } from "node:http"

const DEFAULT_JSON_BODY_LIMIT_BYTES = 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413

  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`)
    this.name = "RequestBodyTooLargeError"
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

export async function readJson(req: IncomingMessage, limit = DEFAULT_JSON_BODY_LIMIT_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > limit) {
      throw new RequestBodyTooLargeError(limit)
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Echo only approved UI origins. `*` combined with a DELETE route that
 * does rm -rf would let any page on the user's browser delete workspaces.
 *
 * `allowedOrigin` may be a comma-separated list (e.g.
 * "http://127.0.0.1:3100,http://100.80.38.41:3100") to support multiple
 * reachable hostnames (loopback + Tailscale + LAN). The string `"*"`
 * disables the origin check — only safe because every mutating method is
 * still gated by `x-beerengineer-token`.
 */
export function setCors(res: ServerResponse, req: IncomingMessage, allowedOrigin: string): void {
  const origin = req.headers.origin
  const allowList = new Set(allowedOrigin.split(",").map(entry => entry.trim()).filter(Boolean))
  const wildcard = allowList.has("*")
  if (typeof origin === "string" && (wildcard || allowList.has(origin))) {
    res.setHeader("access-control-allow-origin", origin)
    res.setHeader("vary", "origin")
    res.setHeader("access-control-allow-credentials", "true")
  }
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS")
  res.setHeader("access-control-allow-headers", "content-type, x-beerengineer-token")
}

const MUTATING_METHODS = new Set(["POST", "DELETE", "PUT", "PATCH"])

export function requireCsrfToken(req: IncomingMessage, token: string): boolean {
  if (!MUTATING_METHODS.has(req.method ?? "")) return true
  const header = req.headers["x-beerengineer-token"]
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === "string" && value === token
}

export function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export { parseLogData } from "../core/jsonEnvelope.js"

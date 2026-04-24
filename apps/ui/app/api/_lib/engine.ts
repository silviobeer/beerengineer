import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { ENGINE_BASE_URL } from "@/lib/api"

const API_TOKEN_ENV = process.env.BEERENGINEER_API_TOKEN

/**
 * Resolve the engine API token. Preference order:
 *   1. `BEERENGINEER_API_TOKEN` env var (shared with the engine startup env).
 *   2. `BEERENGINEER_API_TOKEN_FILE` env var, if set, points at the file
 *       the engine writes on startup.
 *   3. `$XDG_STATE_HOME/beerengineer/api.token` (default).
 *   4. `~/.local/state/beerengineer/api.token` (no XDG_STATE_HOME set).
 *
 * Matches the write-side in `apps/engine/src/api/tokenFile.ts`.
 */
function defaultTokenFile(): string {
  const envPath = process.env.BEERENGINEER_API_TOKEN_FILE
  if (envPath) return resolve(envPath)
  const base = process.env.XDG_STATE_HOME ? resolve(process.env.XDG_STATE_HOME) : join(homedir(), ".local", "state")
  return join(base, "beerengineer", "api.token")
}

function readTokenFromFile(): string | null {
  try {
    const raw = readFileSync(defaultTokenFile(), "utf8").trim()
    return raw || null
  } catch {
    return null
  }
}

export async function forwardToEngine(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = API_TOKEN_ENV ?? readTokenFromFile()
  if (token) headers.set("x-beerengineer-token", token)

  return fetch(`${ENGINE_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  })
}

export function proxyEngineResponse(response: Response): Response {
  const headers = new Headers()
  const contentType = response.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)
  const cacheControl = response.headers.get("cache-control")
  if (cacheControl) headers.set("cache-control", cacheControl)
  const connection = response.headers.get("connection")
  if (connection) headers.set("connection", connection)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

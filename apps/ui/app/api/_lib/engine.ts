import { readdirSync, readFileSync } from "node:fs"
import { ENGINE_BASE_URL } from "@/lib/api"

const API_TOKEN = process.env.BEERENGINEER_API_TOKEN

function detectLocalEngineToken(): string | null {
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
      const pid = entry.name
      let cmdline = ""
      try {
        cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      } catch {
        continue
      }
      if (!cmdline.includes("src/api/server.ts")) continue
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf8")
        const match = environ.match(/(?:^|\0)BEERENGINEER_API_TOKEN=([^\0]+)/)
        if (match?.[1]) return match[1]
      } catch {
        continue
      }
    }
  } catch {
    return null
  }
  return null
}

export async function forwardToEngine(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = API_TOKEN ?? detectLocalEngineToken()
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

import { randomBytes } from "node:crypto"
import { URL } from "node:url"

import { createApiHttpShell } from "./httpShell.js"
import { createApiLifecycleCoordinator } from "./lifecycleCoordinator.js"
import { composeApiPrivilegedDependencies, exportPublicBaseUrlFromConfig } from "./privilegedDependencies.js"
import { registerApiRoutes } from "./routeRegistration.js"
import { writeApiTokenFile } from "./tokenFile.js"
import { writeEnginePidFile } from "./pidFile.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"
const API_TOKEN = process.env.BEERENGINEER_API_TOKEN ?? randomBytes(24).toString("hex")
const API_TOKEN_WAS_PROVIDED = Boolean(process.env.BEERENGINEER_API_TOKEN)

exportPublicBaseUrlFromConfig()

function defaultAllowedOrigins(): string {
  const origins = ["http://127.0.0.1:3100", "http://localhost:3100"]
  const publicBase = process.env.BEERENGINEER_PUBLIC_BASE_URL?.trim()
  if (publicBase) {
    try {
      const url = new URL(publicBase)
      const port = url.port || "3100"
      origins.push(`${url.protocol}//${url.hostname}:${port}`)
    } catch {
      // ignore malformed BEERENGINEER_PUBLIC_BASE_URL — config validator will surface it elsewhere
    }
  }
  return origins.join(",")
}

const ALLOWED_ORIGIN = process.env.BEERENGINEER_UI_ORIGIN ?? defaultAllowedOrigins()

const shell = createApiHttpShell({ allowedOrigin: ALLOWED_ORIGIN, host: HOST, port: PORT })
const dependencies = composeApiPrivilegedDependencies({
  host: HOST,
  port: PORT,
  apiToken: API_TOKEN,
})
const lifecycle = createApiLifecycleCoordinator({
  shell,
  hooks: dependencies.lifecycleHooks,
})

registerApiRoutes(shell, dependencies.routeDependencies, lifecycle)

await lifecycle.start(() => {
  console.log(`beerengineer_ engine listening on http://${HOST}:${PORT}`)
  const pidPath = writeEnginePidFile({
    pid: process.pid,
    host: HOST,
    port: PORT,
    startedAt: new Date().toISOString(),
  })
  console.error(`[engine] wrote pid file to ${pidPath}`)
  if (!API_TOKEN_WAS_PROVIDED) {
    const tokenPath = writeApiTokenFile(API_TOKEN)
    console.error(`[engine] wrote API token to ${tokenPath}`)
  }
})

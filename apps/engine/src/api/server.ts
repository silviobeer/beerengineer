import { URL } from "node:url"
import { createServer as createNetServer } from "node:net"

import { createApiHttpShell } from "./httpShell.js"
import { createApiLifecycleCoordinator } from "./lifecycleCoordinator.js"
import { composeApiPrivilegedDependencies, exportPublicBaseUrlFromConfig } from "./privilegedDependencies.js"
import { registerApiRoutes } from "./routeRegistration.js"
import { writeEnginePidFile } from "./pidFile.js"

const PORT = Number(process.env.PORT ?? 4100)
const HOST = process.env.HOST ?? "127.0.0.1"
const API_TOKEN = process.env.BEERENGINEER_API_TOKEN ?? ""

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

try {
  await new Promise<void>((resolve, reject) => {
    const probe = createNetServer()
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[engine] FATAL: port ${PORT} is already in use by another process.`)
        console.error(`[engine] Run: lsof -ti :${PORT} | xargs kill`)
        process.exit(1)
      }
      reject(err)
    })
    probe.once("listening", () => probe.close(() => resolve()))
    probe.listen(PORT, HOST)
  })
} catch (err) {
  console.error("[engine] port probe failed:", err)
  process.exit(1)
}

await lifecycle.start(() => {
  console.log(`beerengineer_ engine listening on http://${HOST}:${PORT}`)
  const pidPath = writeEnginePidFile({
    pid: process.pid,
    host: HOST,
    port: PORT,
    startedAt: new Date().toISOString(),
  })
  console.error(`[engine] wrote pid file to ${pidPath}`)
  // Gap 5: signal systemd that the engine is fully ready (port bound, startup
  // recovery complete) so the watchdog poll-loop stops waiting and Type=notify
  // units don't time out. Non-fatal if systemd-notify is absent.
  if (process.env.NOTIFY_SOCKET) {
    import("node:child_process").then(({ execFileSync }) => {
      try {
        execFileSync("systemd-notify", ["READY=1"], { timeout: 2000 })
        console.error("[engine] sent READY=1 to systemd")
      } catch {
        // non-fatal — service may not be Type=notify
      }
    }).catch(() => {/* ignore */})
  }
})

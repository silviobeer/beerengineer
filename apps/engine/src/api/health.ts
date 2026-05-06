import type { Db } from "../db/connection.js"

export const ENGINE_SERVICE_NAME = "beerengineer-engine"

export type HealthDbStatus = "ok" | "failed"

export type HealthResponseBody = {
  ok: boolean
  service: typeof ENGINE_SERVICE_NAME
  uptimeMs: number
  db: HealthDbStatus
}

export function probeDb(db: Db): HealthDbStatus {
  try {
    db.prepare("SELECT 1").get()
    return "ok"
  } catch {
    return "failed"
  }
}

export function buildHealthResponse(db: Db): { status: 200 | 503; body: HealthResponseBody } {
  const dbStatus = probeDb(db)
  const ok = dbStatus === "ok"
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service: ENGINE_SERVICE_NAME,
      uptimeMs: Math.round(process.uptime() * 1000),
      db: dbStatus,
    },
  }
}

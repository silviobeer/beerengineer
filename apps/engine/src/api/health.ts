import type { Db } from "../db/connection.js"
import type { Repos } from "../db/repositories.js"
import { getWorkerAdmissionController } from "../core/workerAdmission.js"

export const ENGINE_SERVICE_NAME = "beerengineer-engine"

export type HealthDbStatus = "ok" | "failed"
export type ReadyLeaseWriteStatus = "ok" | "failed" | "skipped"

export type HealthResponseBody = {
  ok: boolean
  service: typeof ENGINE_SERVICE_NAME
  uptimeMs: number
  db: HealthDbStatus
}

export type ReadyResponseBody = HealthResponseBody & {
  startupRecovery: "complete" | "pending"
  shutdown: "idle" | "in_progress"
  leaseWrite: ReadyLeaseWriteStatus
  effectiveWorkerCap: number
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

export function buildReadyResponse(
  db: Db,
  repos: Repos,
  input: { startupRecoveryComplete: boolean; shutdownInFlight: boolean },
): { status: 200 | 503; body: ReadyResponseBody } {
  const dbStatus = probeDb(db)
  const startupRecovery = input.startupRecoveryComplete ? "complete" : "pending"
  const shutdown = input.shutdownInFlight ? "in_progress" : "idle"
  const effectiveWorkerCap = getWorkerAdmissionController(repos).resolution.effectiveWorkerCap
  let leaseWrite: ReadyLeaseWriteStatus = "skipped"

  if (dbStatus === "ok" && startupRecovery === "complete" && shutdown === "idle") {
    try {
      repos.touchWorkflowReadinessSentinel()
      leaseWrite = "ok"
    } catch {
      leaseWrite = "failed"
    }
  }

  const ok = dbStatus === "ok"
    && startupRecovery === "complete"
    && shutdown === "idle"
    && leaseWrite === "ok"

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service: ENGINE_SERVICE_NAME,
      uptimeMs: Math.round(process.uptime() * 1000),
      db: dbStatus,
      startupRecovery,
      shutdown,
      leaseWrite,
      effectiveWorkerCap,
    },
  }
}

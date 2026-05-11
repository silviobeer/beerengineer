import { totalmem } from "node:os"

import type { Repos } from "../db/repositories.js"

export const DEFAULT_WORKER_MEMORY_BYTES = 4 * 1024 * 1024 * 1024
export const DEFAULT_ADMISSION_RECONCILIATION_INTERVAL_MS = 1_000

export type EffectiveWorkerCapResolution = {
  effectiveWorkerCap: number
  source: "override" | "host_memory"
  overrideCap: number | null
  rawDerivedCap: number
  totalMemoryBytes: number | null
  workerMemoryBytes: number | null
}

export type WorkerAdmissionScheduler = {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export type WorkerAdmissionController = ReturnType<typeof createWorkerAdmissionController>

type CreateWorkerAdmissionControllerOptions = {
  scheduler?: WorkerAdmissionScheduler
  reconciliationIntervalMs?: number
}

function defaultScheduler(): WorkerAdmissionScheduler {
  return {
    setInterval(callback, ms) {
      const handle = setInterval(callback, ms)
      handle.unref?.()
      return handle
    },
    clearInterval(handle) {
      clearInterval(handle as ReturnType<typeof setInterval>)
    },
  }
}

function clampWorkerCap(value: number): number {
  return Math.max(1, Math.floor(value))
}

export function resolveEffectiveWorkerCap(input: {
  overrideCap?: number | null
  totalMemoryBytes?: number | null
  workerMemoryBytes?: number | null
} = {}): EffectiveWorkerCapResolution {
  const overrideCap = input.overrideCap == null || !Number.isFinite(input.overrideCap)
    ? null
    : clampWorkerCap(input.overrideCap)
  if (overrideCap != null) {
    return {
      effectiveWorkerCap: overrideCap,
      source: "override",
      overrideCap,
      rawDerivedCap: overrideCap,
      totalMemoryBytes: input.totalMemoryBytes ?? null,
      workerMemoryBytes: input.workerMemoryBytes ?? null,
    }
  }

  const totalMemoryBytes = input.totalMemoryBytes ?? totalmem()
  const workerMemoryBytes = input.workerMemoryBytes ?? DEFAULT_WORKER_MEMORY_BYTES
  const rawDerivedCap = Math.floor(totalMemoryBytes / workerMemoryBytes)
  return {
    effectiveWorkerCap: clampWorkerCap(rawDerivedCap),
    source: "host_memory",
    overrideCap: null,
    rawDerivedCap,
    totalMemoryBytes,
    workerMemoryBytes,
  }
}

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const controllers = new WeakMap<Repos, WorkerAdmissionController>()

export function createWorkerAdmissionController(
  repos: Repos,
  resolution: EffectiveWorkerCapResolution,
  options: CreateWorkerAdmissionControllerOptions = {},
) {
  const existing = controllers.get(repos)
  existing?.dispose()

  const scheduler = options.scheduler ?? defaultScheduler()
  const reconciliationIntervalMs = options.reconciliationIntervalMs ?? DEFAULT_ADMISSION_RECONCILIATION_INTERVAL_MS
  const pending = new Map<string, () => Promise<void>>()
  const launching = new Set<string>()
  let draining = false
  let intervalHandle: unknown | null = null

  const activeRunningCount = (): number => repos.listRunningRuns().length

  const pendingLaunchReservations = (): number =>
    [...launching].filter(runId => {
      const status = repos.getRun(runId)?.status
      return status !== "running" && status !== "completed" && status !== "failed" && status !== "blocked"
    }).length

  const hasCapacity = (): boolean =>
    activeRunningCount() + pendingLaunchReservations() < resolution.effectiveWorkerCap

  const scheduleDrain = (): void => {
    queueMicrotask(() => {
      void drain()
    })
  }

  const launch = async (runId: string, start: () => Promise<void>): Promise<void> => {
    launching.add(runId)
    try {
      await start()
    } finally {
      launching.delete(runId)
      pending.delete(runId)
      scheduleDrain()
    }
  }

  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      const queuedRuns = repos
        .listRuns()
        .filter(run => run.status === "queued")
        .sort((left, right) => left.created_at - right.created_at)

      for (const run of queuedRuns) {
        if (!hasCapacity()) break
        if (launching.has(run.id)) continue
        const start = pending.get(run.id)
        if (!start) continue
        void launch(run.id, start)
      }
    } finally {
      draining = false
    }
  }

  const ensureInterval = (): void => {
    if (intervalHandle != null) return
    intervalHandle = scheduler.setInterval(() => {
      void drain()
    }, reconciliationIntervalMs)
  }

  const controller = {
    resolution,
    hasCapacity,
    runAdmitted(runId: string, start: () => Promise<void>): Promise<void> {
      return launch(runId, start)
    },
    enqueue(runId: string, start: () => Promise<void>): void {
      ensureInterval()
      pending.set(runId, start)
      scheduleDrain()
    },
    notifyCapacityChanged(): void {
      scheduleDrain()
    },
    dispose(): void {
      if (intervalHandle != null) scheduler.clearInterval(intervalHandle)
    },
  }

  controllers.set(repos, controller)
  return controller
}

export function getWorkerAdmissionController(repos: Repos): WorkerAdmissionController {
  const existing = controllers.get(repos)
  if (existing) return existing
  return createWorkerAdmissionController(repos, resolveEffectiveWorkerCap({
    overrideCap: envNumber("BEERENGINEER_WORKER_CAP"),
    totalMemoryBytes: envNumber("BEERENGINEER_HOST_MEMORY_BYTES"),
    workerMemoryBytes: envNumber("BEERENGINEER_WORKER_MEMORY_BYTES"),
  }))
}

export function workerAdmissionStartupLogMessage(resolution: EffectiveWorkerCapResolution): string {
  const source = resolution.source === "override"
    ? `override=${resolution.overrideCap}`
    : `host_memory=${resolution.totalMemoryBytes}, per_worker=${resolution.workerMemoryBytes}, raw=${resolution.rawDerivedCap}`
  return `[engine] worker admission cap set to ${resolution.effectiveWorkerCap} (${source})`
}

import type { Repos, RunRow, WorkerOwnerKind } from "../db/repositories.js"

export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000
export const STALE_WORKER_HEARTBEAT_MS = 120_000
export const WORKER_HEARTBEAT_FAILURE_LIMIT = 3

export type WorkerLeaseSnapshot = {
  runId: string
  workerInstanceId: string
  workerOwnerKind: WorkerOwnerKind
  startedAt: number
  heartbeatAt: number
}

type WorkerLeaseIdentity = {
  runId: string
  workerInstanceId: string
  workerOwnerKind: WorkerOwnerKind
}

export type WorkerLeaseScheduler = {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export type WorkerLeaseHeartbeat = {
  stop(): void
}

function defaultScheduler(): WorkerLeaseScheduler {
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

export function defaultWorkerInstanceId(workerOwnerKind: WorkerOwnerKind): string {
  return `${workerOwnerKind}-${process.pid}`
}

function toSnapshot(run: RunRow | undefined): WorkerLeaseSnapshot | null {
  if (
    !run?.worker_instance_id ||
    !run.worker_owner_kind ||
    run.worker_started_at == null ||
    run.worker_heartbeat_at == null
  ) {
    return null
  }

  return {
    runId: run.id,
    workerInstanceId: run.worker_instance_id,
    workerOwnerKind: run.worker_owner_kind,
    startedAt: run.worker_started_at,
    heartbeatAt: run.worker_heartbeat_at,
  }
}

export function claimWorkerLease(
  repos: Repos,
  input: WorkerLeaseIdentity & { now?: number },
): RunRow | undefined {
  const timestamp = input.now ?? Date.now()
  return repos.claimRunWorkerLease(input.runId, {
    workerInstanceId: input.workerInstanceId,
    workerOwnerKind: input.workerOwnerKind,
    startedAt: timestamp,
    heartbeatAt: timestamp,
  })
}

export function inspectWorkerLease(repos: Repos, runId: string): WorkerLeaseSnapshot | null {
  return toSnapshot(repos.getRun(runId))
}

export function workerStillOwnsLease(repos: Repos, input: WorkerLeaseIdentity): boolean {
  const snapshot = inspectWorkerLease(repos, input.runId)
  return snapshot?.workerInstanceId === input.workerInstanceId
    && snapshot.workerOwnerKind === input.workerOwnerKind
}

export function refreshWorkerHeartbeat(
  repos: Repos,
  input: WorkerLeaseIdentity & { now?: number },
): { kind: "refreshed"; run: RunRow } | { kind: "lost"; current: WorkerLeaseSnapshot | null } {
  const result = repos.refreshRunWorkerHeartbeat(input.runId, {
    workerInstanceId: input.workerInstanceId,
    workerOwnerKind: input.workerOwnerKind,
    heartbeatAt: input.now ?? Date.now(),
  })
  if (result.ok) return { kind: "refreshed", run: result.run }
  return { kind: "lost", current: toSnapshot(result.run) }
}

function markWorkerLeaseRecoverableFailure(
  repos: Repos,
  input: WorkerLeaseIdentity & { summary: string },
): void {
  const run = repos.getRun(input.runId)
  if (!run || run.status !== "running") return
  repos.updateRun(input.runId, {
    status: "failed",
    recovery_status: "failed",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: input.summary,
  })
}

export function startWorkerLeaseHeartbeat(
  repos: Repos,
  input: WorkerLeaseIdentity & {
    now?: () => number
    scheduler?: WorkerLeaseScheduler
    intervalMs?: number
    failureLimit?: number
    onFatal?: (reason: "lost_ownership" | "heartbeat_failures", error?: Error) => void
  },
): WorkerLeaseHeartbeat {
  const scheduler = input.scheduler ?? defaultScheduler()
  const intervalMs = input.intervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS
  const failureLimit = input.failureLimit ?? WORKER_HEARTBEAT_FAILURE_LIMIT
  const now = input.now ?? Date.now
  let consecutiveFailures = 0
  let stopped = false
  let handle: unknown

  const stop = (): void => {
    if (stopped) return
    stopped = true
    scheduler.clearInterval(handle)
  }

  const failRecoverably = (reason: "lost_ownership" | "heartbeat_failures", error?: Error): void => {
    const summary = reason === "lost_ownership"
      ? "Worker heartbeat detected lost worker ownership — resume or abandon."
      : `Worker heartbeat failed ${failureLimit} consecutive times — resume or abandon.`
    markWorkerLeaseRecoverableFailure(repos, { ...input, summary })
    stop()
    input.onFatal?.(reason, error)
  }

  const tick = (): void => {
    if (stopped) return
    try {
      const result = refreshWorkerHeartbeat(repos, { ...input, now: now() })
      if (result.kind === "lost") {
        failRecoverably("lost_ownership")
        return
      }
      consecutiveFailures = 0
    } catch (error) {
      consecutiveFailures += 1
      if (consecutiveFailures >= failureLimit) {
        failRecoverably("heartbeat_failures", error as Error)
      }
    }
  }

  handle = scheduler.setInterval(tick, intervalMs)
  return { stop }
}

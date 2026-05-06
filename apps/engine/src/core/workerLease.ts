import type { Repos, RunRow, WorkerOwnerKind } from "../db/repositories.js"

export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000
export const STALE_WORKER_HEARTBEAT_MS = 120_000

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

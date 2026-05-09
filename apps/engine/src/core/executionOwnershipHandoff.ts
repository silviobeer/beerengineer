import type { Repos, RunRow } from "../db/repositories.js"
import type { WorkerLeaseScheduler } from "./workerLease.js"

export const EXECUTION_OWNERSHIP_HANDOFF_SUMMARY =
  "API worker claimed planning-to-execution handoff."

type HandoffCandidate = Pick<
  RunRow,
  | "id"
  | "status"
  | "owner"
  | "worker_owner_kind"
  | "current_stage"
  | "recovery_status"
  | "recovery_scope"
  | "recovery_scope_ref"
  | "created_at"
>

export type ExecutionOwnershipHandoffResumeInput = {
  runId: string
  summary: string
  apiWorkerInstanceId: string
  workerLeaseClock?: () => number
  workerLeaseScheduler?: WorkerLeaseScheduler
  onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
}

export type ExecutionOwnershipHandoffResumeResult = {
  ok: boolean
}

export type ExecutionOwnershipHandoffResumer = (
  repos: Repos,
  input: ExecutionOwnershipHandoffResumeInput,
) => Promise<ExecutionOwnershipHandoffResumeResult>

export function isExecutionOwnershipHandoffRun(run: HandoffCandidate | undefined): boolean {
  const owner = run?.worker_owner_kind ?? run?.owner
  return run?.status === "blocked"
    && owner === "cli"
    && run.current_stage === "planning"
    && run.recovery_status === "blocked"
    && run.recovery_scope === "stage"
    && run.recovery_scope_ref === "execution"
}

export async function claimExecutionOwnershipHandoffs(
  repos: Repos,
  input: {
    apiWorkerInstanceId: string
    resumeRun: ExecutionOwnershipHandoffResumer
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  },
): Promise<{ claimedRunIds: string[] }> {
  const candidates = repos
    .listRuns()
    .filter(isExecutionOwnershipHandoffRun)
    .sort((left, right) => left.created_at - right.created_at)
  const claimedRunIds: string[] = []

  for (const run of candidates) {
    const claimed = repos.claimBlockedExecutionHandoff(run.id, {
      workerInstanceId: input.apiWorkerInstanceId,
      startedAt: input.workerLeaseClock?.() ?? Date.now(),
    })
    if (!claimed) continue
    const resumed = await input.resumeRun(repos, {
      runId: run.id,
      summary: EXECUTION_OWNERSHIP_HANDOFF_SUMMARY,
      apiWorkerInstanceId: input.apiWorkerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      onItemColumnChanged: input.onItemColumnChanged,
    })
    if (resumed.ok) claimedRunIds.push(run.id)
  }

  return { claimedRunIds }
}


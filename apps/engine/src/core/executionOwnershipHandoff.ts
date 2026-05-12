import type { ExternalRemediationRow, Repos, RunRow } from "../db/repositories.js"
import type { WorkerLeaseScheduler } from "./workerLease.js"

export const EXECUTION_OWNERSHIP_HANDOFF_SUMMARY =
  "API worker claimed planning-to-execution handoff."

type ExecutionOwnershipHandoffRecoveryPayload = {
  kind: "execution_ownership_handoff"
  pendingResumeRemediationId: string | null
  lastAttemptedResumeRemediationId: string | null
}

type HandoffCandidate = Pick<
  RunRow,
  | "id"
  | "status"
  | "owner"
  | "worker_owner_kind"
  | "worker_instance_id"
  | "worker_started_at"
  | "worker_heartbeat_at"
  | "current_stage"
  | "recovery_status"
  | "recovery_scope"
  | "recovery_scope_ref"
  | "recovery_payload_json"
  | "created_at"
>

export type ExecutionOwnershipHandoffResumeInput = {
  runId: string
  remediationId: string
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

function buildExecutionOwnershipHandoffRecoveryPayload(
  patch: Partial<Pick<ExecutionOwnershipHandoffRecoveryPayload, "pendingResumeRemediationId" | "lastAttemptedResumeRemediationId">> = {},
): string {
  return JSON.stringify({
    kind: "execution_ownership_handoff",
    pendingResumeRemediationId: patch.pendingResumeRemediationId ?? null,
    lastAttemptedResumeRemediationId: patch.lastAttemptedResumeRemediationId ?? null,
  } satisfies ExecutionOwnershipHandoffRecoveryPayload)
}

export function parseExecutionOwnershipHandoffRecoveryPayload(
  raw: string | null | undefined,
): ExecutionOwnershipHandoffRecoveryPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ExecutionOwnershipHandoffRecoveryPayload>
    if (parsed.kind !== "execution_ownership_handoff") return null
    return {
      kind: parsed.kind,
      pendingResumeRemediationId:
        typeof parsed.pendingResumeRemediationId === "string" && parsed.pendingResumeRemediationId
          ? parsed.pendingResumeRemediationId
          : null,
      lastAttemptedResumeRemediationId:
        typeof parsed.lastAttemptedResumeRemediationId === "string" && parsed.lastAttemptedResumeRemediationId
          ? parsed.lastAttemptedResumeRemediationId
          : null,
    }
  } catch {
    return null
  }
}

export function executionOwnershipHandoffRecoveryPayloadJson(): string {
  return buildExecutionOwnershipHandoffRecoveryPayload()
}

export function queueExecutionOwnershipHandoffResume(
  repos: Repos,
  runId: string,
  remediationId: string,
): void {
  const run = repos.getRun(runId)
  if (!isExecutionOwnershipHandoffRun(run)) return
  const payload = parseExecutionOwnershipHandoffRecoveryPayload(run?.recovery_payload_json)
  repos.updateRun(runId, {
    recovery_payload_json: buildExecutionOwnershipHandoffRecoveryPayload({
      pendingResumeRemediationId: remediationId,
      lastAttemptedResumeRemediationId: payload?.lastAttemptedResumeRemediationId ?? null,
    }),
  })
}

function pendingExecutionOwnershipHandoffRemediation(
  repos: Repos,
  run: HandoffCandidate,
): ExternalRemediationRow | null {
  const remediationId = parseExecutionOwnershipHandoffRecoveryPayload(run.recovery_payload_json)?.pendingResumeRemediationId
  if (!remediationId) return null
  const remediation = repos.getExternalRemediation(remediationId)
  return remediation?.run_id === run.id ? remediation : null
}

function consumeExecutionOwnershipHandoffResume(
  repos: Repos,
  runId: string,
  remediationId: string,
): void {
  repos.updateRun(runId, {
    recovery_payload_json: buildExecutionOwnershipHandoffRecoveryPayload({
      pendingResumeRemediationId: null,
      lastAttemptedResumeRemediationId: remediationId,
    }),
  })
}

function restoreExecutionOwnershipHandoffClaim(
  repos: Repos,
  run: HandoffCandidate,
): void {
  repos.restoreBlockedExecutionHandoffClaim(run.id, {
    owner: run.owner,
    workerInstanceId: run.worker_instance_id,
    workerOwnerKind: run.worker_owner_kind,
    workerStartedAt: run.worker_started_at,
    workerHeartbeatAt: run.worker_heartbeat_at,
  })
}

export function isExecutionOwnershipHandoffRun(run: HandoffCandidate | undefined): boolean {
  return run?.status === "blocked"
    && run.worker_owner_kind === "cli"
    && run.worker_instance_id != null
    && run.worker_started_at != null
    && run.worker_heartbeat_at != null
    && (run.current_stage === "planning" || run.current_stage === "execution")
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
    const remediation = pendingExecutionOwnershipHandoffRemediation(repos, run)
    if (!remediation) continue
    const claimed = repos.claimBlockedExecutionHandoff(run.id, {
      workerInstanceId: input.apiWorkerInstanceId,
      startedAt: input.workerLeaseClock?.() ?? Date.now(),
    })
    if (!claimed) continue
    let resumed: ExecutionOwnershipHandoffResumeResult
    try {
      resumed = await input.resumeRun(repos, {
        runId: run.id,
        remediationId: remediation.id,
        summary: remediation.summary,
        apiWorkerInstanceId: input.apiWorkerInstanceId,
        workerLeaseClock: input.workerLeaseClock,
        workerLeaseScheduler: input.workerLeaseScheduler,
        onItemColumnChanged: input.onItemColumnChanged,
      })
    } catch (error) {
      restoreExecutionOwnershipHandoffClaim(repos, run)
      throw error
    }
    if (!resumed.ok) {
      restoreExecutionOwnershipHandoffClaim(repos, run)
      continue
    }
    consumeExecutionOwnershipHandoffResume(repos, run.id, remediation.id)
    if (resumed.ok) claimedRunIds.push(run.id)
  }

  return { claimedRunIds }
}

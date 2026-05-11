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

export function isExecutionOwnershipHandoffRun(run: HandoffCandidate | undefined): boolean {
  const owner = run?.worker_owner_kind ?? run?.owner
  return run?.status === "blocked"
    && owner === "cli"
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
    let claimed: RunRow | undefined
    try {
      claimed = repos.claimBlockedExecutionHandoff(run.id, {
        workerInstanceId: input.apiWorkerInstanceId,
        startedAt: input.workerLeaseClock?.() ?? Date.now(),
      })
    } finally {
      consumeExecutionOwnershipHandoffResume(repos, run.id, remediation.id)
    }
    if (!claimed) continue
    const resumed = await input.resumeRun(repos, {
      runId: run.id,
      remediationId: remediation.id,
      summary: remediation.summary,
      apiWorkerInstanceId: input.apiWorkerInstanceId,
      workerLeaseClock: input.workerLeaseClock,
      workerLeaseScheduler: input.workerLeaseScheduler,
      onItemColumnChanged: input.onItemColumnChanged,
    })
    if (resumed.ok) claimedRunIds.push(run.id)
  }

  return { claimedRunIds }
}

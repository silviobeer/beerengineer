import type { RunRow } from "../../db/repositories.js"
import { parseSupabaseProvisioningRecoveryPayload } from "./recoveryPayload.js"

export const RETAINED_DIAGNOSIS_DECISION_REASON = "retained_diagnosis_branch" as const
export const RETAINED_DIAGNOSIS_DECISION_NEXT_ACTIONS = [
  "retry-retained",
  "clear-and-fresh",
] as const

export type RetainedDiagnosisNextAction =
  typeof RETAINED_DIAGNOSIS_DECISION_NEXT_ACTIONS[number]

export type RunRecoveryDecision = {
  kind: "operator_decision_required"
  reason: typeof RETAINED_DIAGNOSIS_DECISION_REASON
  nextActions: RetainedDiagnosisNextAction[]
  branchRef: string | null
}

export function retainedDiagnosisRecoveryDecision(
  run: Pick<RunRow, "recovery_status" | "recovery_payload_json" | "supabase_branch_lifecycle_state" | "supabase_branch_ref">,
): RunRecoveryDecision | null {
  if (run.recovery_status !== "blocked") return null
  if (run.supabase_branch_lifecycle_state !== "retained-for-diagnosis") return null
  const payload = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
  if (!payload) return null
  return {
    kind: "operator_decision_required",
    reason: RETAINED_DIAGNOSIS_DECISION_REASON,
    nextActions: [...RETAINED_DIAGNOSIS_DECISION_NEXT_ACTIONS],
    branchRef: payload.branchRef ?? run.supabase_branch_ref ?? null,
  }
}

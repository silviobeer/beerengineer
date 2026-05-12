import type { Repos, RunRow } from "../../db/repositories.js"
import {
  parseSupabaseProvisioningRecoveryPayload,
  updateSupabaseProvisioningRecoveryPayload,
} from "./recoveryPayload.js"

type RecoveryMutationResult =
  | { ok: true; run: RunRow }
  | { ok: false; error: "run_not_found" | "not_blocked_supabase_recovery" | "branch_ref_required" }

function blockedSupabaseProvisioningRun(
  repos: Repos,
  runId: string,
): { run: RunRow; payloadJson: string } | null {
  const run = repos.getRun(runId)
  if (!run || run.recovery_status !== "blocked") return null
  const payload = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
  if (!payload) return null
  return { run, payloadJson: run.recovery_payload_json! }
}

export function attachSupabaseBranchToRunRecovery(
  repos: Repos,
  input: { runId: string; branchRef: string },
): RecoveryMutationResult {
  const branchRef = input.branchRef.trim()
  if (!branchRef) return { ok: false, error: "branch_ref_required" }
  const active = blockedSupabaseProvisioningRun(repos, input.runId)
  if (!active) {
    return repos.getRun(input.runId)
      ? { ok: false, error: "not_blocked_supabase_recovery" }
      : { ok: false, error: "run_not_found" }
  }

  repos.setRunSupabaseBranch(input.runId, {
    ref: branchRef,
    name: branchRef,
    lifecycleState: active.run.supabase_branch_lifecycle_state ?? "provisioning",
  })
  repos.setRunRecovery(input.runId, {
    status: active.run.recovery_status,
    scope: active.run.recovery_scope,
    scopeRef: active.run.recovery_scope_ref,
    summary: active.run.recovery_summary,
    payloadJson: updateSupabaseProvisioningRecoveryPayload(active.payloadJson, {
      branchRef,
      operatorAction: "attach",
    }) ?? active.payloadJson,
  })
  return { ok: true, run: repos.getRun(input.runId)! }
}

export function discardSupabaseBranchFromRunRecovery(
  repos: Repos,
  input: { runId: string },
): RecoveryMutationResult {
  const active = blockedSupabaseProvisioningRun(repos, input.runId)
  if (!active) {
    return repos.getRun(input.runId)
      ? { ok: false, error: "not_blocked_supabase_recovery" }
      : { ok: false, error: "run_not_found" }
  }

  repos.clearRunSupabaseBranch(input.runId)
  repos.setRunRecovery(input.runId, {
    status: active.run.recovery_status,
    scope: active.run.recovery_scope,
    scopeRef: active.run.recovery_scope_ref,
    summary: active.run.recovery_summary,
    payloadJson: updateSupabaseProvisioningRecoveryPayload(active.payloadJson, {
      branchRef: null,
      operatorAction: "discard",
    }) ?? active.payloadJson,
  })
  return { ok: true, run: repos.getRun(input.runId)! }
}

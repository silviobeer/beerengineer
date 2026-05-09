import { parseSupabaseReadinessRecoveryPayload } from "../core/supabase/recoveryPayload.js"
import type { BoardProjector } from "./boardProjectionTypes.js"

export const projectBoardSupabase: BoardProjector = ({ workspace, latestRun }) => {
  const supabaseBranch = latestRun?.supabase_branch_ref
    ? {
        ref: latestRun.supabase_branch_ref,
        name: latestRun.supabase_branch_name ?? latestRun.supabase_branch_ref,
        lifecycleState: latestRun.supabase_branch_lifecycle_state,
      }
    : undefined

  if (latestRun?.recovery_status !== "blocked") {
    return {
      supabaseProjectRef: workspace.supabase_project_ref ?? null,
      dbRelevance: {
        value: Boolean(supabaseBranch),
        source: "detector" as const,
        reason: supabaseBranch ? "Supabase branch provisioned" : "No Supabase branch provisioned",
      },
      supabaseBranch,
    }
  }

  const payload = parseSupabaseReadinessRecoveryPayload(latestRun.recovery_payload_json)
  const supabaseBlocker = payload
    ? {
        status: "blocked" as const,
        label: "Supabase blocked" as const,
        runId: latestRun.id,
        workspace: { id: payload.workspace.id ?? workspace.id, key: payload.workspace.key ?? workspace.key },
        missingSetupActions: payload.missingSetupActions,
        message: latestRun.recovery_summary ?? payload.message,
        retry: { available: payload.retry.available, ready: payload.missingSetupActions.length === 0 },
      }
    : undefined

  return {
    supabaseBlocker,
    supabaseProjectRef: workspace.supabase_project_ref ?? null,
    dbRelevance: {
      value: Boolean(supabaseBranch),
      source: "detector" as const,
      reason: supabaseBranch ? "Supabase branch provisioned" : "No Supabase branch provisioned",
    },
    supabaseBranch,
  }
}

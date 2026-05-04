import type { Repos } from "../db/repositories.js"
import type { DestructiveMigrationFinding } from "../core/supabase/destructiveDetector.js"

export type MergeGateStatus = "pass" | "block" | "pending" | "skipped"

export type MergeStatusGate = {
  status: MergeGateStatus
  reason: string
  operations?: DestructiveMigrationFinding[]
}

export type MergeStatusView = {
  runId: string
  gates: {
    finalValidation: MergeStatusGate
    protectionSwitch: MergeStatusGate
    destructiveConfirmation: MergeStatusGate
    productionMigration: MergeStatusGate
  }
}

/** Sentinel returned when neither the workspace nor the run carries any Supabase
 * context and no destructive findings exist — the merge gates are not relevant
 * for this workspace, so the UI should not render the gate panel. */
export type MergeStatusNotRelevant = { supabaseRelevant: false }

/** Discriminated union returned by {@link buildMergeStatus}.
 *  - `null` → run not found (route maps to 404).
 *  - `{ supabaseRelevant: false }` → non-Supabase workspace with no destructive findings (200, panel hidden).
 *  - `MergeStatusView` → full four-gate object (200, panel rendered). */
export type MergeStatusResult = MergeStatusView | MergeStatusNotRelevant | null

export function buildMergeStatus(input: {
  repos: Repos
  runId: string
  destructiveFindings?: DestructiveMigrationFinding[]
  destructiveConfirmed?: boolean
  productionMigrationStatus?: MergeGateStatus
  productionMigrationReason?: string
}): MergeStatusResult {
  const run = input.repos.getRun(input.runId)
  if (!run) return null
  const workspace = input.repos.getWorkspace(run.workspace_id)
  const findings = input.destructiveFindings ?? []
  // Bug fix BUG-PROJ4-QA-011: If neither the workspace nor the run is bound to
  // any Supabase resource AND no destructive findings exist, the four merge
  // gates do not apply. Return a discriminated sentinel so the UI can hide the
  // gate panel instead of showing four red blocks on every non-Supabase merge.
  // Destructive findings are workspace-agnostic — they always force the gates
  // to render so the user can review/acknowledge them.
  const hasSupabaseContext = Boolean(workspace?.supabase_project_ref) || Boolean(run.supabase_branch_ref)
  if (!hasSupabaseContext && findings.length === 0) {
    return { supabaseRelevant: false }
  }
  const lifecycle = run.supabase_branch_lifecycle_state
  const protection = workspace?.supabase_protection_switch ?? "off"
  const destructiveBlocked = findings.length > 0 && input.destructiveConfirmed !== true
  return {
    runId: input.runId,
    gates: {
      finalValidation: lifecycle === "validated"
        ? { status: "pass", reason: "final wave validated" }
        : { status: "block", reason: `final validation incomplete: ${lifecycle ?? "missing"}` },
      protectionSwitch: protection === "on"
        ? { status: "pass", reason: "protection switch on" }
        : { status: "block", reason: "protection switch off" },
      destructiveConfirmation: destructiveBlocked
        ? { status: "block", reason: "destructive operations require per-merge confirmation", operations: findings }
        : { status: findings.length > 0 ? "pass" : "skipped", reason: findings.length > 0 ? "destructive operations confirmed for this merge" : "no destructive operations detected" },
      productionMigration: protection === "off"
        ? { status: "skipped", reason: "production-migration-skipped-because-off" }
        : { status: input.productionMigrationStatus ?? "pending", reason: input.productionMigrationReason ?? "waiting for merge gates" },
    },
  }
}

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

export function buildMergeStatus(input: {
  repos: Repos
  runId: string
  destructiveFindings?: DestructiveMigrationFinding[]
  destructiveConfirmed?: boolean
  productionMigrationStatus?: MergeGateStatus
  productionMigrationReason?: string
}): MergeStatusView | null {
  const run = input.repos.getRun(input.runId)
  if (!run) return null
  const workspace = input.repos.getWorkspace(run.workspace_id)
  const lifecycle = run.supabase_branch_lifecycle_state
  const protection = workspace?.supabase_protection_switch ?? "off"
  const findings = input.destructiveFindings ?? []
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

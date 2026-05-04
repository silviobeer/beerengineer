import type { Repos } from "../../db/repositories.js"
import type { SupabaseAdapter, SupabaseAdapterResult } from "../../core/supabase/types.js"
import type { DestructiveMigrationFinding } from "../../core/supabase/destructiveDetector.js"

export type MergeGateResult = { ok: true; message?: string } | { ok: false; error: string; details?: unknown }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function finalWaveValidationGate(input: { dbRelevant: boolean; lifecycleState?: string | null; failingStep?: string; providerMessage?: string }): MergeGateResult {
  if (!input.dbRelevant) return { ok: true }
  if (input.lifecycleState === "validated") return { ok: true }
  return {
    ok: false,
    error: "final_wave_validation_failed",
    details: {
      failingStep: input.failingStep ?? "db-tests",
      message: input.providerMessage ?? `Final DB-relevant wave is ${input.lifecycleState ?? "missing"}`,
    },
  }
}

export async function mergeWithProtectionSwitch(input: {
  protectionSwitch: "off" | "on"
  gitMerge: () => void
  migrateProduction: () => Promise<SupabaseAdapterResult>
}): Promise<MergeGateResult> {
  const snapshot = input.protectionSwitch
  input.gitMerge()
  if (snapshot === "off") {
    return { ok: true, message: "production migration skipped: protection switch off; enable in settings if desired" }
  }
  const result = await input.migrateProduction()
  return result.ok ? { ok: true } : { ok: false, error: "production_migration_failed", details: result.context }
}

export function destructiveConfirmationGate(input: {
  findings: DestructiveMigrationFinding[]
  confirmedForThisMerge?: boolean
}): MergeGateResult {
  if (input.findings.length === 0) return { ok: true }
  if (input.confirmedForThisMerge === true) return { ok: true, message: "destructive operations confirmed for this merge" }
  return { ok: false, error: "destructive_migration_confirmation_required", details: input.findings }
}

export async function completeMergeWithProductionMigration(input: {
  repos: Repos
  adapter: Pick<SupabaseAdapter, "migrateProduction">
  cleanup: () => Promise<void> | void
  context: { workspaceId: string; projectRef: string; branchRef: string; runId: string; workspaceRoot: string }
}): Promise<MergeGateResult> {
  let result = await input.adapter.migrateProduction(input.context)
  if (!result.ok && result.context?.retryAfter) {
    const delayMs = Number(result.context.retryAfter) * 1_000
    if (Number.isFinite(delayMs) && delayMs > 0) await sleep(delayMs)
    result = await input.adapter.migrateProduction(input.context)
  }
  if (!result.ok) {
    input.repos.setRunSupabaseLifecycleState(input.context.runId, "retained-for-diagnosis")
    return { ok: false, error: "production_migration_failed", details: { ...result.context, diagnosisHref: "#supabase-diagnosis" } }
  }
  await input.cleanup()
  return { ok: true }
}

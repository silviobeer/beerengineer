import type { SupabaseAdapter, SupabaseWorkspaceContext } from "../../core/supabase/types.js"
import type { WaveDefinition } from "../../types.js"
import type { Repos } from "../../db/repositories.js"
import { writeSupabaseHandoff, ensureSupabaseHandoffGitignore } from "../../core/supabase/handoffWriter.js"
import type { SupabaseHandoffClient } from "../../core/supabase/handoffWriter.js"

export type SupabaseWaveProvisionResult = {
  dbRelevantWave: boolean
  provisioned: boolean
  reason?: string
}

/** Canonical result for the orchestrated provision → poll → handoff → validate sequence. */
export type SupabaseWaveOrchestrationResult =
  | { ok: true; branchRef: string; handoffPath: string }
  | { ok: false; error: string; details?: unknown }

export function isDbRelevantWave(wave: WaveDefinition): boolean {
  if (typeof wave.dbRelevantWave === "boolean") return wave.dbRelevantWave
  return wave.stories.some(story => story.dbRelevant === true)
}

/**
 * Simple provision helper kept for backward compat and unit-testing of the
 * non-DB-relevant skip path (used by the existing supabaseSkip test).
 */
export async function runSupabaseProvisionIfDbRelevant(
  wave: WaveDefinition,
  adapter: SupabaseAdapter,
  context: SupabaseWorkspaceContext,
): Promise<SupabaseWaveProvisionResult> {
  if (!isDbRelevantWave(wave)) {
    return { dbRelevantWave: false, provisioned: false, reason: "wave is not DB-relevant" }
  }

  await adapter.provisionBranch({ ...context, waveId: wave.id })
  return { dbRelevantWave: true, provisioned: true }
}

/**
 * Canonical orchestration entry point (BUG-PROJ4-QA-005 wiring point 1).
 *
 * Sequence (for DB-relevant waves):
 *   1. provisionBranch  → get branchRef
 *   2. pollBranchStatus → wait for ACTIVE_HEALTHY
 *   3. writeSupabaseHandoff → write dotenv for workers/validators
 *   4. ensureSupabaseHandoffGitignore → idempotent .gitignore entry
 *   5. validateBranch → run migrations + seeds + DB tests
 *
 * Non-DB-relevant waves: returns ok=true immediately without any adapter calls.
 */
export async function provisionWaveIfDbRelevant(input: {
  wave: WaveDefinition
  adapter: SupabaseAdapter
  context: SupabaseWorkspaceContext
  repos?: Repos
  handoffClient?: SupabaseHandoffClient
}): Promise<SupabaseWaveOrchestrationResult> {
  const { wave, adapter, context } = input

  if (!isDbRelevantWave(wave)) {
    return { ok: true, branchRef: context.branchRef ?? "", handoffPath: "" }
  }

  // Step 1: provision
  const provisionResult = await adapter.provisionBranch({ ...context, waveId: wave.id })
  if (!provisionResult.ok) {
    return {
      ok: false,
      error: String(provisionResult.context?.message ?? provisionResult.context?.error ?? "provision_failed"),
      details: provisionResult.context,
    }
  }
  const branchRef = String(provisionResult.context?.branchRef ?? context.branchRef ?? "")

  // Step 2: poll until ACTIVE_HEALTHY
  const pollResult = await adapter.pollBranchStatus({ ...context, waveId: wave.id, branchRef })
  if (!pollResult.ok) {
    return {
      ok: false,
      error: String(pollResult.context?.reason ?? "poll_failed"),
      details: pollResult.context,
    }
  }

  // Step 3: write handoff dotenv (architecture decision 18: write before validation)
  let handoffPath = ""
  if (
    input.handoffClient &&
    context.workspaceRoot &&
    context.runId &&
    wave.id &&
    context.projectRef &&
    branchRef
  ) {
    try {
      await ensureSupabaseHandoffGitignore(context.workspaceRoot)
      const handoff = await writeSupabaseHandoff({
        workspaceRoot: context.workspaceRoot,
        runId: context.runId,
        waveId: wave.id,
        projectRef: context.projectRef,
        branchRef,
        client: input.handoffClient,
      })
      handoffPath = handoff.path
    } catch (err) {
      // EEXIST means the handoff already exists (resume path); continue
      if ((err as NodeJS.ErrnoException).code === "EEXIST" ||
          (err as Error).message?.includes("already exists")) {
        // idempotent — find the path without re-writing
        const { supabaseHandoffPath } = await import("../../core/supabase/handoffWriter.js")
        handoffPath = supabaseHandoffPath(context.workspaceRoot, context.runId, wave.id)
      } else {
        return { ok: false, error: "handoff_write_failed", details: (err as Error).message }
      }
    }
  }

  // Step 4: validate (migrations + seeds + DB tests)
  const validateResult = await adapter.validateBranch({
    ...context,
    waveId: wave.id,
    branchRef,
  })
  if (!validateResult.ok) {
    if (context.runId && input.repos) {
      input.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
    }
    return {
      ok: false,
      error: String(validateResult.context?.message ?? "validate_failed"),
      details: validateResult.context,
    }
  }

  return { ok: true, branchRef, handoffPath }
}

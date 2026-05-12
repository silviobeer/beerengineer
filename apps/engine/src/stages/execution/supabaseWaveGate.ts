import type { SupabaseAdapter, SupabaseWorkspaceContext } from "../../core/supabase/types.js"
import type { WaveDefinition } from "../../types.js"
import type { Repos } from "../../db/repositories.js"
import { writeSupabaseHandoff, ensureSupabaseHandoffGitignore } from "../../core/supabase/handoffWriter.js"
import type { SupabaseHandoffClient } from "../../core/supabase/handoffWriter.js"
import {
  humanizeSupabaseProvisioningFailure,
  type SupabaseProvisioningFailure,
} from "../../core/supabase/provisioningRecovery.js"

export type SupabaseWaveProvisionResult = {
  dbRelevantWave: boolean
  provisioned: boolean
  reason?: string
}

/** Canonical result for the orchestrated provision → poll → handoff → validate sequence. */
export type SupabaseWaveOrchestrationResult =
  | { ok: true; branchRef: string; handoffPath: string }
  | ({ ok: false } & SupabaseProvisioningFailure & { details?: unknown })

export function isDbRelevantWave(wave: WaveDefinition): boolean {
  if (typeof wave.dbRelevantWave === "boolean") return wave.dbRelevantWave
  return wave.stories.some(story => story.dbRelevant === true)
}

function contextWithBranchRef(
  context: Record<string, unknown> | undefined,
  branchRef: string,
): Record<string, unknown> {
  return context
    ? { ...context, branchRef }
    : { branchRef }
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

  if (context.dbMode === "direct") {
    const directHandoff = await writeWaveHandoff({
      handoffClient: input.handoffClient,
      workspaceRoot: context.workspaceRoot,
      runId: context.runId,
      waveId: wave.id,
      projectRef: context.projectRef,
      dbMode: "direct",
      branchRef: context.branchRef,
    })
    if (!directHandoff.ok) {
      return {
        ok: false,
        ...humanizeSupabaseProvisioningFailure("handoff", {
          error: directHandoff.error,
          details: directHandoff.details,
          branchRef: context.branchRef,
        }),
        details: directHandoff.details,
      }
    }
    return { ok: true, branchRef: "", handoffPath: directHandoff.handoffPath }
  }

  // Step 1: provision
  let provisionResult
  try {
    provisionResult = await adapter.provisionBranch({ ...context, waveId: wave.id })
  } catch (err) {
    return { ok: false, ...humanizeSupabaseProvisioningFailure("provision", err), details: err }
  }
  if (!provisionResult.ok) {
    return { ok: false, ...humanizeSupabaseProvisioningFailure("provision", provisionResult.context), details: provisionResult.context }
  }
  const branchRef = String(provisionResult.context?.branchRef ?? context.branchRef ?? "")

  // Step 2: poll until ACTIVE_HEALTHY
  let pollResult
  try {
    pollResult = await adapter.pollBranchStatus({ ...context, waveId: wave.id, branchRef })
  } catch (err) {
    return { ok: false, ...humanizeSupabaseProvisioningFailure("poll", { error: err, branchRef }), details: err }
  }
  if (!pollResult.ok) {
    return { ok: false, ...humanizeSupabaseProvisioningFailure("poll", contextWithBranchRef(pollResult.context, branchRef)), details: pollResult.context }
  }

  // Step 3: write handoff dotenv (architecture decision 18: write before validation)
  const handoff = await writeWaveHandoff({
    handoffClient: input.handoffClient,
    workspaceRoot: context.workspaceRoot,
    runId: context.runId,
    waveId: wave.id,
    projectRef: context.projectRef,
    dbMode: "branching",
    branchRef,
  })
  if (!handoff.ok) {
    return {
      ok: false,
      ...humanizeSupabaseProvisioningFailure("handoff", { error: handoff.error, details: handoff.details, branchRef }),
      details: handoff.details,
    }
  }
  const handoffPath = handoff.handoffPath

  // Step 4: validate (migrations + seeds + DB tests)
  let validateResult
  try {
    validateResult = await adapter.validateBranch({
      ...context,
      waveId: wave.id,
      branchRef,
    })
  } catch (err) {
    return { ok: false, ...humanizeSupabaseProvisioningFailure("validate", { error: err, branchRef }), details: err }
  }
  if (!validateResult.ok) {
    if (context.runId && input.repos) {
      input.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
    }
    return { ok: false, ...humanizeSupabaseProvisioningFailure("validate", contextWithBranchRef(validateResult.context, branchRef)), details: validateResult.context }
  }

  return { ok: true, branchRef, handoffPath }
}

async function writeWaveHandoff(input: {
  handoffClient?: SupabaseHandoffClient
  workspaceRoot?: string
  runId?: string
  waveId: string
  projectRef?: string
  dbMode: "branching" | "direct"
  branchRef?: string
}): Promise<
  | { ok: true; handoffPath: string }
  | { ok: false; error: string; details?: unknown }
> {
  const missingDependencies: string[] = []
  if (input.handoffClient == null) missingDependencies.push("handoffClient")
  if (input.workspaceRoot == null || input.workspaceRoot === "") missingDependencies.push("workspaceRoot")
  if (input.runId == null || input.runId === "") missingDependencies.push("runId")
  if (input.projectRef == null || input.projectRef === "") missingDependencies.push("projectRef")

  if (missingDependencies.length > 0) {
    return {
      ok: false,
      error: "handoff_dependency_missing",
      details: `Missing Supabase post-create handoff dependency: ${missingDependencies.join(", ")}`,
    }
  }
  try {
    await ensureSupabaseHandoffGitignore(input.workspaceRoot)
    const handoff = await writeSupabaseHandoff({
      workspaceRoot: input.workspaceRoot,
      runId: input.runId,
      waveId: input.waveId,
      projectRef: input.projectRef,
      dbMode: input.dbMode,
      branchRef: input.branchRef,
      client: input.handoffClient,
    })
    return { ok: true, handoffPath: handoff.path }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : ""
    if ((err as NodeJS.ErrnoException).code === "EEXIST" ||
        errorMessage.includes("already exists")) {
      const { supabaseHandoffPath } = await import("../../core/supabase/handoffWriter.js")
      return { ok: true, handoffPath: supabaseHandoffPath(input.workspaceRoot, input.runId, input.waveId) }
    }
    return { ok: false, error: "handoff_write_failed", details: errorMessage || String(err) }
  }
}

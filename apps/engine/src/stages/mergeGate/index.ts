import { randomUUID } from "node:crypto"
import { branchNameItem } from "../../core/branchNames.js"
import { hasEventBus } from "../../core/bus.js"
import type { GitAdapter } from "../../core/gitAdapter.js"
import { getWorkflowIO } from "../../core/io.js"
import type { RecoveryCause, RecoveryScope } from "../../core/recovery.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { stagePresent } from "../../core/stagePresentation.js"
import type { WorkflowContext } from "../../core/workspaceLayout.js"
import type { SupabaseWorkflowHook } from "../../core/supabase/workflowHook.js"
import {
  finalWaveValidationGate,
  destructiveConfirmationGate,
  mergeWithProtectionSwitch,
  completeMergeWithProductionMigration,
} from "./supabaseGates.js"
import { detectDestructiveMigrations } from "../../core/supabase/destructiveDetector.js"
import { listSupabaseSqlFiles } from "../../core/supabase/migrationRunner.js"
import { readFileSync } from "node:fs"

type BlockRunFn = (
  context: WorkflowContext,
  summary: string,
  opts?: {
    cause?: RecoveryCause
    scope?: RecoveryScope
    detail?: string
    evidencePaths?: string[]
    branch?: string
  },
) => Promise<never>

function normalizeMergeGateAnswer(answer: string): "promote" | "cancel" | string {
  const normalized = answer.trim().toLowerCase()
  if (["promote", "approve", "approved", "yes", "y"].includes(normalized)) return "promote"
  if (["cancel", "no", "n"].includes(normalized)) return "cancel"
  return answer.trim()
}

/**
 * BUG-PROJ4-QA-005 wiring point 4: Supabase gate stack before mergeItemIntoBase.
 *
 * Gate sequence (only when supabaseHook is provided and workspace has Supabase context):
 *   1. finalWaveValidationGate — confirms last DB-relevant wave validated
 *   2. destructiveConfirmationGate — blocks if unconfirmed destructive findings
 *   3. mergeWithProtectionSwitch — runs git merge + conditionally runs production migration
 *   4. completeMergeWithProductionMigration — handles retry-after & cleanup
 *
 * When supabaseHook is undefined (no Supabase workspace), falls through to the
 * existing unconditional merge path — no behavior change for non-Supabase runs.
 */
export async function mergeGate(
  context: WorkflowContext,
  git: GitAdapter,
  blockRun: BlockRunFn,
  supabaseHook?: SupabaseWorkflowHook,
): Promise<void> {
  const activeRun = getActiveRun()
  if (!activeRun) {
    // `merge-gate` is only reachable under an active run in production.
    // Keep the legacy direct-runWorkflow test path working, but make the
    // compatibility contract explicit rather than silently looking like the
    // normal operator-gated path.
    git.assertWorkspaceRootOnBaseBranch("before merge-gate (test-only direct workflow path)")
    git.mergeItemIntoBase()
    return
  }

  git.assertWorkspaceRootOnBaseBranch("before merge-gate")
  const itemBranch = branchNameItem(context)
  const prompt = `Promote ${itemBranch} into ${git.mode.baseBranch}?`
  const actions = [
    { label: `Promote to ${git.mode.baseBranch}`, value: "promote" },
    { label: "Cancel", value: "cancel" },
  ] as const

  stagePresent.header("MERGE")
  stagePresent.step(`Awaiting promotion of ${itemBranch} into ${git.mode.baseBranch}`)

  const io = getWorkflowIO()
  const promptId = randomUUID()
  emitEvent({
    type: "merge_gate_open",
    runId: activeRun.runId,
    itemId: activeRun.itemId,
    itemBranch,
    baseBranch: git.mode.baseBranch,
    gatePromptId: promptId,
  })
  const answerPromise = hasEventBus(io)
    ? io.bus.request(prompt, {
        promptId,
        runId: activeRun.runId,
        stageRunId: activeRun.stageRunId ?? null,
        actions: [...actions],
      })
    : io.ask(prompt, { promptId, actions: [...actions] })
  const answer = normalizeMergeGateAnswer(await answerPromise)

  if (answer === "cancel") {
    emitEvent({
      type: "merge_gate_cancelled",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      itemBranch,
      baseBranch: git.mode.baseBranch,
    })
    await blockRun(
      context,
      `Operator postponed merge of ${itemBranch} into ${git.mode.baseBranch}`,
      {
        cause: "merge_gate_cancelled",
        scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
        branch: itemBranch,
      },
    )
  }
  if (answer !== "promote") {
    await blockRun(
      context,
      `Merge gate received unsupported answer for ${itemBranch}: ${answer || "<empty>"}`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
        branch: itemBranch,
      },
    )
  }

  // BUG-PROJ4-QA-005 wiring point 4: Supabase gate stack
  if (supabaseHook) {
    const run = supabaseHook.repos.getRun(activeRun.runId)
    const lifecycleState = run?.supabase_branch_lifecycle_state ?? null
    const dbRelevant = Boolean(run?.supabase_branch_ref)

    // Gate 1: final wave validation
    const validationGate = finalWaveValidationGate({ dbRelevant, lifecycleState })
    if (!validationGate.ok) {
      await blockRun(
        context,
        `Merge blocked: final wave validation incomplete (state=${lifecycleState ?? "missing"})`,
        {
          cause: "merge_gate_failed",
          scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
          branch: itemBranch,
        },
      )
    }

    // Gate 2: destructive confirmation
    const migrations = context.workspaceRoot
      ? (() => {
          try {
            const files = listSupabaseSqlFiles(context.workspaceRoot!)
            return files.migrations.map(file => ({
              file,
              sql: (() => { try { return readFileSync(file, "utf8") } catch { return "" } })(),
            }))
          } catch { return [] }
        })()
      : []
    const findings = detectDestructiveMigrations({ migrations })
    // destructiveConfirmed lives on the operator-supplied answer. We don't have
    // a per-merge session flag yet — treat as unconfirmed if findings exist
    // (the UI gate panel already exposes the confirmation toggle).
    const destructiveGate = destructiveConfirmationGate({ findings, confirmedForThisMerge: false })
    if (!destructiveGate.ok) {
      await blockRun(
        context,
        `Merge blocked: destructive migration operations require per-merge confirmation`,
        {
          cause: "merge_gate_failed",
          scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
          branch: itemBranch,
        },
      )
    }

    // Gates 3+4: protection switch + production migration (via mergeWithProtectionSwitch
    // which captures the switch value atomically before the git merge runs).
    const mergeContext = {
      workspaceId: supabaseHook.workspaceId,
      projectRef: supabaseHook.projectRef,
      branchRef: run?.supabase_branch_ref ?? supabaseHook.parentBranchRef,
      runId: activeRun.runId,
      workspaceRoot: context.workspaceRoot ?? "",
    }
    const mergeResult = await mergeWithProtectionSwitch({
      protectionSwitch: supabaseHook.protectionSwitch,
      gitMerge: () => {
        try {
          const { mergeSha } = git.mergeItemIntoBase()
          emitEvent({
            type: "merge_completed",
            runId: activeRun.runId,
            itemId: activeRun.itemId,
            itemBranch,
            baseBranch: git.mode.baseBranch,
            mergeSha,
          })
        } catch (error) {
          throw error
        }
      },
      migrateProduction: () => supabaseHook.adapter.migrateProduction(mergeContext),
    })

    if (!mergeResult.ok) {
      // Production migration failed after the git merge (QA-009 ordering hazard).
      // Mark retained-for-diagnosis so the operator knows recovery is needed.
      supabaseHook.repos.setRunSupabaseLifecycleState(activeRun.runId, "retained-for-diagnosis")
      await blockRun(
        context,
        `Merge blocked: production migration failed — operator-driven recovery required`,
        {
          cause: "merge_gate_failed",
          scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
          branch: itemBranch,
        },
      )
    }
    // Gate stack passed — merge already happened inside mergeWithProtectionSwitch.
    return
  }

  // Non-Supabase path: unconditional merge.
  try {
    const { mergeSha } = git.mergeItemIntoBase()
    emitEvent({
      type: "merge_completed",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      itemBranch,
      baseBranch: git.mode.baseBranch,
      mergeSha,
    })
  } catch (error) {
    await blockRun(
      context,
      `Merge into ${git.mode.baseBranch} failed for ${itemBranch}: ${(error as Error).message}`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: activeRun.runId, stageId: "merge-gate" },
        branch: itemBranch,
      },
    )
  }
}

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

type ActiveMergeRun = NonNullable<ReturnType<typeof getActiveRun>>

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
    mergeGateWithoutActiveRun(git)
    return
  }

  git.assertWorkspaceRootOnBaseBranch("before merge-gate")
  const itemBranch = branchNameItem(context)
  stagePresent.header("MERGE")
  stagePresent.step(`Awaiting promotion of ${itemBranch} into ${git.mode.baseBranch}`)
  await requirePromotionAnswer({ context, git, activeRun, itemBranch, blockRun })

  const performGitMerge = () => {
    const { mergeSha } = git.mergeItemIntoBase()
    emitEvent({
      type: "merge_completed",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      itemBranch,
      baseBranch: git.mode.baseBranch,
      mergeSha,
    })
  }

  if (supabaseHook?.dbMode === "direct") {
    await mergeOrBlock({ context, git, activeRun, itemBranch, blockRun, performGitMerge })
    return
  }

  // BUG-PROJ4-QA-005 wiring point 4: Supabase gate stack
  if (supabaseHook) {
    await runSupabaseMergeGate({
      context,
      activeRun,
      itemBranch,
      blockRun,
      supabaseHook,
      performGitMerge,
    })
    return
  }

  // Non-Supabase path: unconditional merge.
  await mergeOrBlock({ context, git, activeRun, itemBranch, blockRun, performGitMerge })
}

function mergeGateWithoutActiveRun(git: GitAdapter): void {
  // `merge-gate` is only reachable under an active run in production.
  // Keep the legacy direct-runWorkflow test path working, but make the
  // compatibility contract explicit rather than silently looking like the
  // normal operator-gated path.
  git.assertWorkspaceRootOnBaseBranch("before merge-gate (test-only direct workflow path)")
  git.mergeItemIntoBase()
}

async function requirePromotionAnswer(input: {
  context: WorkflowContext
  git: GitAdapter
  activeRun: ActiveMergeRun
  itemBranch: string
  blockRun: BlockRunFn
}): Promise<void> {
  const answer = await promptForMergeAnswer(input.git, input.activeRun, input.itemBranch)
  if (answer === "cancel") {
    emitEvent({
      type: "merge_gate_cancelled",
      runId: input.activeRun.runId,
      itemId: input.activeRun.itemId,
      itemBranch: input.itemBranch,
      baseBranch: input.git.mode.baseBranch,
    })
    await input.blockRun(
      input.context,
      `Operator postponed merge of ${input.itemBranch} into ${input.git.mode.baseBranch}`,
      {
        cause: "merge_gate_cancelled",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }
  if (answer !== "promote") {
    await input.blockRun(
      input.context,
      `Merge gate received unsupported answer for ${input.itemBranch}: ${answer || "<empty>"}`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }
}

async function promptForMergeAnswer(
  git: GitAdapter,
  activeRun: ActiveMergeRun,
  itemBranch: string,
): Promise<"promote" | "cancel" | string> {
  const prompt = `Promote ${itemBranch} into ${git.mode.baseBranch}?`
  const actions = [
    { label: `Promote to ${git.mode.baseBranch}`, value: "promote" },
    { label: "Cancel", value: "cancel" },
  ] as const
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
  return normalizeMergeGateAnswer(await answerPromise)
}

async function mergeOrBlock(input: {
  context: WorkflowContext
  git: GitAdapter
  activeRun: ActiveMergeRun
  itemBranch: string
  blockRun: BlockRunFn
  performGitMerge: () => void
}): Promise<void> {
  try {
    input.performGitMerge()
  } catch (error) {
    await input.blockRun(
      input.context,
      `Merge into ${input.git.mode.baseBranch} failed for ${input.itemBranch}: ${(error as Error).message}`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }
}

async function runSupabaseMergeGate(input: {
  context: WorkflowContext
  activeRun: ActiveMergeRun
  itemBranch: string
  blockRun: BlockRunFn
  supabaseHook: SupabaseWorkflowHook
  performGitMerge: () => void
}): Promise<void> {
  const run = input.supabaseHook.repos.getRun(input.activeRun.runId)
  const lifecycleState = run?.supabase_branch_lifecycle_state ?? null
  const dbRelevant = Boolean(run?.supabase_branch_ref)

  const validationGate = finalWaveValidationGate({ dbRelevant, lifecycleState })
  if (!validationGate.ok) {
    await input.blockRun(
      input.context,
      `Merge blocked: final wave validation incomplete (state=${lifecycleState ?? "missing"})`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }

  const destructiveGate = destructiveConfirmationGate({
    findings: loadDestructiveFindings(input.context.workspaceRoot),
    confirmedForThisMerge: false,
  })
  if (!destructiveGate.ok) {
    await input.blockRun(
      input.context,
      `Merge blocked: destructive migration operations require per-merge confirmation`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }

  const mergeResult = await mergeWithProtectionSwitch({
    protectionSwitch: input.supabaseHook.protectionSwitch,
    gitMerge: () => input.performGitMerge(),
    migrateProduction: () => input.supabaseHook.adapter.migrateProduction({
      workspaceId: input.supabaseHook.workspaceId,
      projectRef: input.supabaseHook.projectRef,
      branchRef: run?.supabase_branch_ref ?? input.supabaseHook.parentBranchRef,
      runId: input.activeRun.runId,
      workspaceRoot: input.context.workspaceRoot ?? "",
    }),
  })

  if (!mergeResult.ok) {
    input.supabaseHook.repos.setRunSupabaseLifecycleState(input.activeRun.runId, "retained-for-diagnosis")
    await input.blockRun(
      input.context,
      `Merge blocked: production migration failed — operator-driven recovery required`,
      {
        cause: "merge_gate_failed",
        scope: { type: "stage", runId: input.activeRun.runId, stageId: "merge-gate" },
        branch: input.itemBranch,
      },
    )
  }
}

function loadDestructiveFindings(workspaceRoot: string | undefined) {
  if (!workspaceRoot) return detectDestructiveMigrations({ migrations: [] })
  try {
    const files = listSupabaseSqlFiles(workspaceRoot)
    return detectDestructiveMigrations({
      migrations: files.migrations.map(file => ({
        file,
        sql: safeReadSql(file),
      })),
    })
  } catch {
    return detectDestructiveMigrations({ migrations: [] })
  }
}

function safeReadSql(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

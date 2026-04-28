import { randomUUID } from "node:crypto"
import { branchNameItem } from "../../core/branchNames.js"
import type { GitAdapter } from "../../core/gitAdapter.js"
import { getWorkflowIO } from "../../core/io.js"
import type { RecoveryCause, RecoveryScope } from "../../core/recovery.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { stagePresent } from "../../core/stagePresentation.js"
import type { WorkflowContext } from "../../core/workspaceLayout.js"

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

export async function mergeGate(
  context: WorkflowContext,
  git: GitAdapter,
  blockRun: BlockRunFn,
): Promise<void> {
  const activeRun = getActiveRun()
  if (!activeRun) {
    git.assertWorkspaceRootOnBaseBranch("before merge-gate")
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
  emitEvent({
    type: "item_column_changed",
    runId: activeRun.runId,
    itemId: activeRun.itemId,
    column: "merge",
    phaseStatus: "review_required",
  })

  const io = getWorkflowIO() as ReturnType<typeof getWorkflowIO> & {
    bus?: { request: (promptText: string, opts?: { promptId?: string; runId?: string; stageRunId?: string | null; actions?: typeof actions }) => Promise<string> }
  }
  const promptId = randomUUID()
  emitEvent({
    type: "merge_gate_open",
    runId: activeRun.runId,
    itemId: activeRun.itemId,
    itemBranch,
    baseBranch: git.mode.baseBranch,
    gatePromptId: promptId,
  })
  const answerPromise = io.bus
    ? io.bus.request(prompt, {
        promptId,
        runId: activeRun.runId,
        stageRunId: activeRun.stageRunId ?? null,
        actions: [...actions],
      })
    : io.ask(prompt, { actions: [...actions] })
  const answer = (await answerPromise).trim()

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

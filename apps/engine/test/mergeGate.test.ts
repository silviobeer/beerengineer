import { test } from "node:test"
import assert from "node:assert/strict"

import { mergeGate } from "../src/stages/mergeGate/index.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import type { GitAdapter } from "../src/core/gitAdapter.js"
import type { WorkflowContext } from "../src/core/workspaceLayout.js"

const context: WorkflowContext = {
  workspaceId: "item-1",
  workspaceRoot: "/tmp/workspace",
  runId: "run-1",
  itemSlug: "demo-item",
  baseBranch: "master",
}

function makeGit(): GitAdapter {
  return {
    enabled: true,
    mode: {
      enabled: true,
      kind: "workspace-root",
      workspaceRoot: "/tmp/workspace",
      baseBranch: "master",
      itemWorktreeRoot: "/tmp/workspace/.beerengineer/worktrees",
    },
    ensureItemBranch() {},
    ensureProjectBranch() {},
    mergeProjectIntoItem() {},
    mergeItemIntoBase() {
      return { mergeSha: "deadbeef" }
    },
    ensureWaveBranch() {
      return "wave"
    },
    ensureStoryBranch() {
      return "story"
    },
    ensureStoryWorktree() {
      return "/tmp/story"
    },
    mergeStoryIntoWave() {},
    mergeWaveIntoProject() {},
    rebaseStoryOntoWave() {
      return { ok: true }
    },
    abandonStoryBranch() {
      return null
    },
    removeStoryWorktree() {},
    exitRunToItemBranch() {
      return "item/demo-item"
    },
    assertWorkspaceRootOnBaseBranch() {},
    gcManagedStoryWorktrees() {
      return { removed: [], kept: [], errors: [] }
    },
  }
}

test("mergeGate blocks instead of merging on unexpected free-text answers", async () => {
  const git = makeGit()
  let merged = false
  git.mergeItemIntoBase = () => {
    merged = true
    return { mergeSha: "deadbeef" }
  }

  let blocked: { summary: string; cause?: string } | null = null

  await assert.rejects(
    runWithWorkflowIO(
      {
        ask: async () => "hold",
        emit: () => {},
      },
      () =>
        runWithActiveRun({ runId: "run-1", itemId: "ITEM-1", stageRunId: "stage-1" }, () =>
          mergeGate(context, git, async (_ctx, summary, opts) => {
            blocked = { summary, cause: opts?.cause }
            throw new Error("blocked")
          }),
        ),
    ),
    /blocked/,
  )

  assert.equal(merged, false)
  assert.equal(blocked?.cause, "merge_gate_failed")
  assert.match(blocked?.summary ?? "", /unsupported answer/i)
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { sep } from "node:path"

import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"

const ctx: WorkflowContext = { workspaceId: "demo-ws-1", runId: "2026-04-22T08-00-00-000Z" }

test("workspaceDir and workspaceFile include workspace id under .beerengineer/workspaces", () => {
  const dir = layout.workspaceDir(ctx.workspaceId)
  assert.ok(dir.endsWith(`.beerengineer${sep}workspaces${sep}demo-ws-1`))
  assert.equal(layout.workspaceFile(ctx.workspaceId), `${dir}${sep}workspace.json`)
})

test("runDir and runFile nest under workspace/runs/<runId>", () => {
  const runDir = layout.runDir(ctx)
  assert.ok(runDir.endsWith(`demo-ws-1${sep}runs${sep}${ctx.runId}`))
  assert.equal(layout.runFile(ctx), `${runDir}${sep}run.json`)
})

test("stageDir sanitizes stage id segments (case + non-[a-z0-9/-] replaced with '-')", () => {
  const dir = layout.stageDir(ctx, "Execution/Waves.Wave 1/Stories/US_1")
  assert.ok(dir.includes(`${sep}stages${sep}execution/waves-wave-1/stories/us-1`))
})

test("stageArtifactsDir, stageRunFile, stageLogFile sit inside stageDir", () => {
  const base = layout.stageDir(ctx, "brainstorm")
  assert.equal(layout.stageArtifactsDir(ctx, "brainstorm"), `${base}${sep}artifacts`)
  assert.equal(layout.stageRunFile(ctx, "brainstorm"), `${base}${sep}run.json`)
  assert.equal(layout.stageLogFile(ctx, "brainstorm"), `${base}${sep}log.jsonl`)
})

test("repoState and handoff helpers produce deterministic paths", () => {
  assert.ok(
    layout.repoStateWorkspaceFile(ctx.workspaceId).endsWith(`demo-ws-1${sep}repo-state.json`),
  )
  assert.ok(layout.repoStateRunFile(ctx).endsWith(`${ctx.runId}${sep}repo-state.json`))
  const handoffDir = layout.handoffDir(ctx)
  assert.ok(handoffDir.endsWith(`${ctx.runId}${sep}handoffs`))
  assert.equal(
    layout.handoffFile(ctx, "PROJ-42"),
    `${handoffDir}${sep}proj-42-merge-handoff.json`,
  )
})

test("item worktree helpers are item-scoped and story worktrees are run-scoped beneath them", () => {
  const itemCtx: WorkflowContext = { ...ctx, itemSlug: "Dark Mode Toggle" }
  const itemRoot = layout.itemWorktreeRootDir(itemCtx)
  assert.ok(itemRoot.endsWith(`.beerengineer${sep}worktrees${sep}demo-ws-1${sep}items${sep}dark-mode-toggle`))
  assert.equal(layout.itemWorktreeDir(itemCtx), `${itemRoot}${sep}worktree`)
  assert.equal(layout.itemStoriesRootDir(itemCtx), `${itemRoot}${sep}stories`)
  assert.equal(
    layout.executionStoryWorktreeDir(itemCtx, 3, "US_1"),
    `${itemRoot}${sep}stories${sep}${ctx.runId.toLowerCase()}__us-1${sep}worktree`,
  )
})

test("execution helpers nest wave -> story -> test-writer / ralph", () => {
  const waveDir = layout.executionWaveDir(ctx, 3)
  assert.ok(waveDir.endsWith(`stages${sep}execution${sep}waves${sep}wave-3`))
  const storyDir = layout.executionStoryDir(ctx, 3, "US_1")
  assert.equal(storyDir, `${waveDir}${sep}stories${sep}US_1`)
  assert.equal(layout.executionTestWriterDir(ctx, 3, "US_1"), `${storyDir}${sep}test-writer`)
  assert.equal(layout.executionRalphDir(ctx, 3, "US_1"), `${storyDir}${sep}ralph`)
  assert.equal(layout.waveSummaryFile(ctx, 3), `${waveDir}${sep}wave-summary.json`)
})

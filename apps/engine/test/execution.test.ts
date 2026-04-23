import { test } from "node:test"
import assert from "node:assert/strict"

import { assertWaveSucceeded, executionStageLlmForStory } from "../src/stages/execution/index.js"
import { shouldIgnoreTransientUntrackedPath } from "../src/llm/hosted/execution/coderHarness.js"
import { defaultWorkspaceRuntimePolicy } from "../src/core/workspaces.js"

test("assertWaveSucceeded rejects blocked stories", () => {
  assert.throws(
    () =>
      assertWaveSucceeded(
        { id: "W2", number: 2, goal: "Parallel work", dependencies: [], internallyParallelizable: true, stories: [] },
        {
          waveId: "W2",
          waveBranch: "wave/demo__p01__w2",
          projectBranch: "proj/demo__p01",
          storiesMerged: [],
          storiesBlocked: ["US-02"],
        },
      ),
    /Wave W2 blocked stories: US-02/,
  )
})

test("assertWaveSucceeded accepts fully merged waves", () => {
  assert.doesNotThrow(() =>
      assertWaveSucceeded(
      { id: "W1", number: 1, goal: "Sequential work", dependencies: [], internallyParallelizable: false, stories: [] },
      {
        waveId: "W1",
        waveBranch: "wave/demo__p01__w1",
        projectBranch: "proj/demo__p01",
        storiesMerged: [{ storyId: "US-01", branch: "story/p01-us-01", commitCount: 3, filesIntegrated: [] }],
        storiesBlocked: [],
      },
    ),
  )
})

test("executionStageLlmForStory pins hosted stages to the story worktree", () => {
  const llm = {
    workspaceRoot: "/repo/main",
    harnessProfile: { mode: "fast" } as const,
    runtimePolicy: defaultWorkspaceRuntimePolicy(),
  }

  assert.deepEqual(executionStageLlmForStory(llm, "/repo/worktrees/story-002"), {
    ...llm,
    workspaceRoot: "/repo/worktrees/story-002",
  })
  assert.equal(executionStageLlmForStory(llm), llm)
  assert.equal(executionStageLlmForStory(undefined, "/repo/worktrees/story-002"), undefined)
})

test("shouldIgnoreTransientUntrackedPath excludes install/cache directories only", () => {
  assert.equal(shouldIgnoreTransientUntrackedPath("node_modules/express/index.js"), true)
  assert.equal(shouldIgnoreTransientUntrackedPath("node_modules/.package-lock.json"), true)
  assert.equal(shouldIgnoreTransientUntrackedPath(".git/index"), true)
  assert.equal(shouldIgnoreTransientUntrackedPath(".beerengineer/workspace.json"), true)
  assert.equal(shouldIgnoreTransientUntrackedPath("public/index.html"), false)
  assert.equal(shouldIgnoreTransientUntrackedPath("docs/QA-RESULTS.md"), false)
  assert.equal(shouldIgnoreTransientUntrackedPath("src/main.ts"), false)
})

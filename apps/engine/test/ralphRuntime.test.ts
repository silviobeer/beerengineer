import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runRalphStory, writeWaveSummary, type StoryArtifacts } from "../src/stages/execution/ralphRuntime.js"
import { layout } from "../src/core/workspaceLayout.js"
import { resetTestReviewAdapters, setTestReviewAdapters } from "../src/review/registry.js"
import type { StoryExecutionContext, StoryTestPlanArtifact } from "../src/types.js"

const ctx = { workspaceId: "ws-ralph", runId: "run-ralph", itemSlug: "ralph-item", baseBranch: "main" }

function testPlan(storyId: string): StoryTestPlanArtifact {
  return {
    project: { id: "P01", name: "P" },
    story: { id: storyId, title: `Story ${storyId}` },
    acceptanceCriteria: [
      { id: "AC-01", text: "must work", priority: "must", category: "functional" },
    ],
    testPlan: {
      summary: `plan for ${storyId}`,
      testCases: [
        { id: "TC-1", name: "t", mapsToAcId: "AC-01", type: "integration", description: "d" },
      ],
      fixtures: [],
      edgeCases: [],
      assumptions: [],
    },
  }
}

function storyContext(storyId: string): StoryExecutionContext {
  return {
    item: { slug: "ralph-item", baseBranch: "main" },
    project: { id: "P01", name: "P" },
    conceptSummary: "concept",
    story: {
      id: storyId,
      title: `Story ${storyId}`,
      acceptanceCriteria: [
        { id: "AC-01", text: "x", priority: "must", category: "functional" },
      ],
    },
    architectureSummary: {
      summary: "sum",
      systemShape: "shape",
      constraints: [],
      relevantComponents: [],
    },
    wave: { id: "W1", number: 1, goal: "g", dependencies: [] },
    testPlan: testPlan(storyId),
  }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-ralph-"))
  const prev = process.cwd()
  process.chdir(dir)
  const originalLog = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = originalLog
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
}

test("runRalphStory goes through 3 review cycles, ending in passed + merged branch", async () => {
  await withTmpCwd(async () => {
    const result: StoryArtifacts = await runRalphStory(storyContext("US-10"), ctx)

    assert.equal(result.implementation.status, "passed")
    assert.ok(result.review, "review artifact present")
    assert.equal(result.review?.outcome, "pass")
    // 3 review cycles needed because sonar only passes on cycle 3
    assert.equal(result.implementation.currentReviewCycle, 2)

    // First cycle uses 2 implementation iterations (iter 2 turns green); subsequent cycles
    // apply remediation in a single iteration. Total: 2 + 1 + 1 = 4 iterations.
    assert.equal(result.implementation.iterations.length, 4)
    const cycleBuckets = new Map<number, number>()
    for (const it of result.implementation.iterations) {
      cycleBuckets.set(it.reviewCycle, (cycleBuckets.get(it.reviewCycle) ?? 0) + 1)
    }
    assert.equal(cycleBuckets.get(0), 2, "cycle 0 needs 2 impl iterations")
    assert.equal(cycleBuckets.get(1), 1, "cycle 1 remediation turns green in 1")
    assert.equal(cycleBuckets.get(2), 1, "cycle 2 remediation turns green in 1")

    // Branch was created, committed to, and merged
    assert.ok(result.implementation.branch)
    assert.equal(result.implementation.branch?.status, "merged")
    assert.equal(result.implementation.branch?.name, "story/ralph-item__p01__w1__us-10")
    assert.ok((result.implementation.branch?.commits.length ?? 0) >= 4)

    // Persisted artifacts
    const dir = layout.executionRalphDir(ctx, 1, "US-10")
    const persistedImpl = JSON.parse(await readFile(join(dir, "implementation.json"), "utf8"))
    assert.equal(persistedImpl.status, "passed")
    assert.ok(Array.isArray(persistedImpl.priorAttempts))
    assert.equal(persistedImpl.priorAttempts.length, persistedImpl.iterations.length)
    const persistedReview = JSON.parse(await readFile(join(dir, "story-review.json"), "utf8"))
    assert.equal(persistedReview.outcome, "pass")
    // Per-cycle review snapshots
    const cycle3Review = JSON.parse(
      await readFile(join(dir, "story-review-cycle-3.json"), "utf8"),
    )
    assert.equal(cycle3Review.reviewCycle, 3)

    // Log contains branch events and iteration entries
    const log = (await readFile(join(dir, "log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(l => JSON.parse(l))
    const types = new Set(log.map(e => e.type))
    for (const expected of ["branch_event", "iteration", "review_revise", "review_pass", "status_changed"]) {
      assert.ok(types.has(expected), `log should contain ${expected} entries`)
    }
  })
})

test("runRalphStory resumes from persisted state (no duplicate work)", async () => {
  await withTmpCwd(async () => {
    await runRalphStory(storyContext("US-20"), ctx)
    const dir = layout.executionRalphDir(ctx, 1, "US-20")
    const firstImpl = JSON.parse(await readFile(join(dir, "implementation.json"), "utf8"))
    assert.equal(firstImpl.status, "passed")

    // Second call: should early-return because status is passed
    const again = await runRalphStory(storyContext("US-20"), ctx)
    assert.equal(again.implementation.status, "passed")
    // Iterations stay the same
    assert.equal(again.implementation.iterations.length, firstImpl.iterations.length)
  })
})

test("runRalphStory records pass-partial when one tool passes and the other is skipped", async () => {
  await withTmpCwd(async () => {
    setTestReviewAdapters({
      coderabbit: async () => ({
        status: "skipped",
        reason: "coderabbit-disabled",
        findings: [],
        rawPath: "coderabbit.raw.txt",
        command: [],
        exitCode: 0,
      }),
      sonarcloud: async () => ({
        status: "ran",
        passed: true,
        conditions: [{ metric: "reliability", status: "ok", actual: "A", threshold: "A" }],
        findings: [],
        rawScanPath: "sonar-scan.raw.txt",
        rawGatePath: "sonar-gate.raw.json",
        command: [],
        exitCode: 0,
      }),
    })
    try {
      const result = await runRalphStory(storyContext("US-30"), ctx)
      assert.equal(result.implementation.status, "passed")
      assert.equal(result.review?.outcome, "pass-partial")
      assert.deepEqual(result.review?.gate.coderabbit, {
        status: "skipped",
        reason: "coderabbit-disabled",
      })
      assert.deepEqual(result.review?.gate.sonar, {
        status: "ran",
        passed: true,
        conditions: [{ metric: "reliability", status: "ok", actual: "A", threshold: "A" }],
      })
      assert.match(result.review?.feedbackSummary.join("\n") ?? "", /\[tool-status\] coderabbit: skipped/)
    } finally {
      resetTestReviewAdapters()
    }
  })
})

test("writeWaveSummary classifies stories by status", async () => {
  await withTmpCwd(async () => {
    const summary = await writeWaveSummary(ctx, { id: "W-X", number: 7 }, "P01", [
      {
        storyId: "S1",
        implementation: {
          story: { id: "S1", title: "S1" },
          mode: "ralph-wiggum",
          status: "passed",
          implementationGoal: "",
          maxIterations: 4,
          maxReviewCycles: 3,
          currentReviewCycle: 2,
          iterations: [],
          changedFiles: ["src/s1.ts"],
          finalSummary: "ok",
          branch: { name: "story/ralph-item__p01__w7__s1", base: "wave/ralph-item__p01__w7", commits: [{ hash: "a", message: "m", filesChanged: [] }], status: "merged" },
        },
      },
      {
        storyId: "S2",
        implementation: {
          story: { id: "S2", title: "S2" },
          mode: "ralph-wiggum",
          status: "blocked",
          implementationGoal: "",
          maxIterations: 4,
          maxReviewCycles: 3,
          currentReviewCycle: 2,
          iterations: [],
          changedFiles: [],
          finalSummary: "stuck",
        },
      },
    ])

    assert.equal(summary.waveId, "W-X")
    assert.equal(summary.waveBranch, "wave/ralph-item__p01__w7")
    assert.equal(summary.projectBranch, "proj/ralph-item__p01")
    assert.equal(summary.storiesMerged.length, 1)
    assert.equal(summary.storiesMerged[0].storyId, "S1")
    assert.equal(summary.storiesBlocked.length, 1)
    assert.equal(summary.storiesBlocked[0], "S2")

    const persisted = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 7), "utf8"))
    assert.deepEqual(persisted, summary)
  })
})

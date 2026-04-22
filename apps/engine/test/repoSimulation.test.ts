import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  abandonBranch,
  appendBranchCommit,
  branchNameCandidate,
  branchNameProject,
  branchNameStory,
  branchNameWave,
  createCandidateBranch,
  ensureWaveBranch,
  ensureStoryBranch,
  finalizeCandidateDecision,
  mergeProjectBranchIntoItem,
  mergeStoryBranchIntoWave,
  mergeWaveBranchIntoProject,
} from "../src/core/repoSimulation.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"
import type { DocumentationArtifact, SimulatedRepoState } from "../src/types.js"

const ctx: WorkflowContext = {
  workspaceId: "ws-repo",
  runId: "run-repo-1",
  itemSlug: "cockpit-overlay",
  baseBranch: "develop",
}

function doc(): DocumentationArtifact {
  return {
    project: { id: "P01", name: "P" },
    mode: "generate",
    technicalDoc: { title: "t", summary: "s", sections: [] },
    featuresDoc: { title: "f", summary: "s", sections: [] },
    compactReadme: { title: "r", summary: "s", sections: [] },
    knownIssues: [],
  }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-repo-"))
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
}

async function readRepoState(): Promise<SimulatedRepoState> {
  return JSON.parse(await readFile(layout.repoStateWorkspaceFile(ctx.workspaceId), "utf8"))
}

test("branchNameStory and branchNameCandidate lowercase", () => {
  assert.equal(branchNameProject(ctx, "P01"), "proj/cockpit-overlay__p01")
  assert.equal(branchNameWave(ctx, "P01", 2), "wave/cockpit-overlay__p01__w2")
  assert.equal(branchNameStory(ctx, "P01", 2, "US-02"), "story/cockpit-overlay__p01__w2__us-02")
  assert.equal(
    branchNameCandidate({ workspaceId: "ws", runId: "RUN-X", itemSlug: "Cockpit Overlay" }),
    "candidate/run-x__cockpit-overlay",
  )
})

test("ensureStoryBranch creates item/project/wave/story branches, idempotent on repeat", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    const b1 = await ensureStoryBranch(ctx, "P01", 1, "US-1")
    assert.equal(b1.name, "story/cockpit-overlay__p01__w1__us-1")
    assert.equal(b1.base, "wave/cockpit-overlay__p01__w1")

    const state = await readRepoState()
    const names = state.branches.map(b => b.name).sort()
    assert.deepEqual(names, [
      "develop",
      "item/cockpit-overlay",
      "proj/cockpit-overlay__p01",
      "story/cockpit-overlay__p01__w1__us-1",
      "wave/cockpit-overlay__p01__w1",
    ])

    const b2 = await ensureStoryBranch(ctx, "P01", 1, "US-1")
    assert.equal(b2.name, b1.name)
    const state2 = await readRepoState()
    assert.equal(state2.branches.length, state.branches.length, "no duplicate branches on idempotent call")
  })
})

test("appendBranchCommit adds commits with deterministic-ish hashes", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    const name = "story/cockpit-overlay__p01__w1__us-1"

    const b1 = await appendBranchCommit(ctx, name, "first commit", ["src/a.ts"])
    const b2 = await appendBranchCommit(ctx, name, "second commit", ["src/b.ts"])
    assert.equal(b1.commits.length, 1)
    assert.equal(b2.commits.length, 2)
    assert.notEqual(b1.commits[0].hash, b2.commits[1].hash)
    assert.deepEqual(b2.commits[1].filesChanged, ["src/b.ts"])
  })
})

test("mergeStoryBranchIntoWave then mergeWaveBranchIntoProject promotes work through the branch tree", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    await appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-1", "work", ["src/a.ts"])

    const { storyBranch, waveBranch } = await mergeStoryBranchIntoWave(
      ctx,
      "P01",
      1,
      "story/cockpit-overlay__p01__w1__us-1",
      ["src/a.ts"],
    )
    assert.equal(storyBranch.status, "merged")
    assert.ok(storyBranch.mergedAt)
    assert.equal(waveBranch.name, "wave/cockpit-overlay__p01__w1")
    assert.equal(waveBranch.commits.length, 1)
    assert.match(waveBranch.commits[0].message, /Merge story\/cockpit-overlay__p01__w1__us-1/)

    const { projectBranch } = await mergeWaveBranchIntoProject(ctx, "P01", 1)
    assert.equal(projectBranch.name, "proj/cockpit-overlay__p01")
    assert.equal(projectBranch.commits.length, 1)
    assert.match(projectBranch.commits[0].message, /Merge wave\/cockpit-overlay__p01__w1/)
  })
})

test("abandonBranch sets status abandoned; subsequent commit reopens it", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    const abandoned = await abandonBranch(ctx, "story/cockpit-overlay__p01__w1__us-1")
    assert.equal(abandoned.status, "abandoned")

    const reopened = await appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-1", "resurrect", [])
    assert.equal(reopened.status, "open")
  })
})

test("appendBranchCommit on unknown branch throws", async () => {
  await withTmpCwd(async () => {
    await assert.rejects(() => appendBranchCommit(ctx, "story/missing", "m", []), /Missing simulated branch/)
  })
})

test("createCandidateBranch clones project commits + adds docs commit, writes handoff file", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    await appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-1", "w", ["x"])
    await mergeStoryBranchIntoWave(ctx, "P01", 1, "story/cockpit-overlay__p01__w1__us-1", ["x"])
    await mergeWaveBranchIntoProject(ctx, "P01", 1)
    await mergeProjectBranchIntoItem(ctx, "P01")

    const handoff = await createCandidateBranch(ctx, { id: "P01", name: "P" }, doc())
    assert.equal(handoff.candidateBranch.name, branchNameCandidate(ctx))
    assert.equal(handoff.candidateBranch.base, "item/cockpit-overlay")
    assert.equal(handoff.candidateBranch.status, "open")
    assert.equal(handoff.readyForMerge, true)
    assert.equal(handoff.mergeTargetBranch, "develop")

    const persisted = JSON.parse(await readFile(layout.handoffFile(ctx, "P01"), "utf8"))
    assert.equal(persisted.candidateBranch.name, handoff.candidateBranch.name)

    const state = await readRepoState()
    const candidate = state.branches.find(b => b.name === handoff.candidateBranch.name)
    assert.ok(candidate)
    // inherits item merge commit + appends docs commit
    assert.equal(candidate!.commits.length, 2)
  })
})

test("parallel repo-state mutations preserve every story branch and merge", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await Promise.all([
      ensureStoryBranch(ctx, "P01", 1, "US-1"),
      ensureStoryBranch(ctx, "P01", 1, "US-2"),
    ])

    await Promise.all([
      appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-1", "work-1", ["src/us1.ts"]),
      appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-2", "work-2", ["src/us2.ts"]),
    ])

    await Promise.all([
      mergeStoryBranchIntoWave(ctx, "P01", 1, "story/cockpit-overlay__p01__w1__us-1", ["src/us1.ts"]),
      mergeStoryBranchIntoWave(ctx, "P01", 1, "story/cockpit-overlay__p01__w1__us-2", ["src/us2.ts"]),
    ])
    await mergeWaveBranchIntoProject(ctx, "P01", 1)

    const state = await readRepoState()
    const story1 = state.branches.find(branch => branch.name === "story/cockpit-overlay__p01__w1__us-1")
    const story2 = state.branches.find(branch => branch.name === "story/cockpit-overlay__p01__w1__us-2")
    const wave = state.branches.find(branch => branch.name === "wave/cockpit-overlay__p01__w1")
    const project = state.branches.find(branch => branch.name === "proj/cockpit-overlay__p01")

    assert.equal(story1?.status, "merged")
    assert.equal(story2?.status, "merged")
    assert.equal(wave?.commits.length, 2)
    assert.equal(project?.commits.length, 1)
    assert.deepEqual(
      wave?.commits.map(commit => commit.filesChanged[0]).sort(),
      ["src/us1.ts", "src/us2.ts"],
    )
  })
})

test("finalizeCandidateDecision merges into the captured base branch / rejects / leaves test", async () => {
  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    await appendBranchCommit(ctx, "story/cockpit-overlay__p01__w1__us-1", "w", ["x"])
    await mergeStoryBranchIntoWave(ctx, "P01", 1, "story/cockpit-overlay__p01__w1__us-1", ["x"])
    await mergeWaveBranchIntoProject(ctx, "P01", 1)
    await mergeProjectBranchIntoItem(ctx, "P01")
    const handoff = await createCandidateBranch(ctx, { id: "P01", name: "P" }, doc())

    const merged = await finalizeCandidateDecision(ctx, handoff, "merge")
    assert.equal(merged.decision, "merge")
    assert.equal(merged.candidateBranch.status, "merged")

    const state = await readRepoState()
    const base = state.branches.find(b => b.name === "develop")!
    assert.equal(base.commits.length, 1)
    assert.match(base.commits[0].message, /Merge candidate\//)
    assert.ok(state.mergedRuns.includes(ctx.runId))
  })

  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    const handoff = await createCandidateBranch(ctx, { id: "P01", name: "P" }, doc())
    const rejected = await finalizeCandidateDecision(ctx, handoff, "reject")
    assert.equal(rejected.candidateBranch.status, "abandoned")
    const state = await readRepoState()
    assert.equal(state.branches.find(b => b.name === "develop")!.commits.length, 0)
  })

  await withTmpCwd(async () => {
    await ensureWaveBranch(ctx, "P01", 1)
    await ensureStoryBranch(ctx, "P01", 1, "US-1")
    const handoff = await createCandidateBranch(ctx, { id: "P01", name: "P" }, doc())
    const kept = await finalizeCandidateDecision(ctx, handoff, "test")
    assert.equal(kept.candidateBranch.status, "open")
    assert.equal(kept.decision, "test")
  })
})

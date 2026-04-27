import { test } from "node:test"
import assert from "node:assert/strict"

import { createWaveCoordinator } from "../src/stages/execution/waveCoordinator.js"

test("waveCoordinator advances generation on every notifyMergedStory", () => {
  const c = createWaveCoordinator(["s1", "s2", "s3"])
  assert.equal(c.currentGeneration(), 0)
  c.notifyMergedStory("s1")
  assert.equal(c.currentGeneration(), 1)
  c.notifyMergedStory("s2")
  assert.equal(c.currentGeneration(), 2)
})

test("waveCoordinator: shouldRebase only returns true when wave HEAD has advanced", () => {
  const c = createWaveCoordinator(["s1", "s2"])
  // No merges yet → no rebase needed.
  assert.equal(c.shouldRebase("s1"), false)
  assert.equal(c.shouldRebase("s2"), false)
  c.notifyMergedStory("s1")
  // s1 was merged; s2 needs to rebase before its next iteration.
  assert.equal(c.shouldRebase("s2"), true)
  // Calling twice without markRebased keeps shouldRebase true (idempotent).
  assert.equal(c.shouldRebase("s2"), true)
})

test("waveCoordinator: markRebased clears the flag until next merge", () => {
  const c = createWaveCoordinator(["s1", "s2", "s3"])
  c.notifyMergedStory("s1")
  assert.equal(c.shouldRebase("s2"), true)
  c.markRebased("s2")
  assert.equal(c.shouldRebase("s2"), false)
  // Now s3 also gets merged, advancing generation again.
  c.notifyMergedStory("s3")
  assert.equal(c.shouldRebase("s2"), true)
})

test("waveCoordinator: abandonStory makes shouldRebase always false and records the reason", () => {
  const c = createWaveCoordinator(["s1", "s2"])
  c.notifyMergedStory("s1")
  c.abandonStory("s2", "rebase_conflict_on:package.json")
  assert.equal(c.shouldRebase("s2"), false)
  // Re-abandoning is a no-op on the abandonments list.
  c.abandonStory("s2", "different reason")
  assert.deepEqual(c.abandonments(), [
    { storyId: "s2", reason: "rebase_conflict_on:package.json" },
  ])
})

test("waveCoordinator: an unknown story id never asks to rebase", () => {
  const c = createWaveCoordinator(["s1"])
  c.notifyMergedStory("s1")
  assert.equal(c.shouldRebase("not-registered"), false)
})

test.todo(
  "TODO(merge-conflict-cascade-fix-2): rebase-on-merge is not yet wired into ralphRuntime " +
  "iteration boundaries. The waveCoordinator + rebaseStoryOntoWave primitives are ready, " +
  "but threading them through the cycled-loop runtime so an in-flight story rebases between " +
  "test+coder cycles requires changes to ralphRuntime.runRalphStory + iterationLoop signatures " +
  "that are out of scope for the current change. The parallel-stories path (BEERENGINEER_" +
  "EXECUTION_PARALLEL_STORIES) defaults OFF, so the safe sequential path (Fix 1) protects " +
  "today's runs; rebase-on-merge remains opt-in for an operator who has explicitly enabled " +
  "the parallel mode and accepted the runtime risk."
)

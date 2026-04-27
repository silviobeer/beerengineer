import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  PROJECT_STAGE_ORDER,
  PROJECT_STAGE_REGISTRY,
  shouldRunProjectStage,
  type ProjectResumePlan,
  type ProjectStageId,
} from "../src/core/projectStageRegistry.ts"

describe("shouldRunProjectStage", () => {
  it("returns true for every stage when no resume plan is supplied", () => {
    for (const id of PROJECT_STAGE_ORDER) {
      assert.equal(shouldRunProjectStage(undefined, id), true, `expected ${id} to run on a fresh run`)
    }
  })

  it("runs the start stage and every later stage; skips earlier stages", () => {
    // For every (startStage × stage) pair, the rule is:
    //   index(stage) >= index(startStage) → run
    //   else → skip (resumeFromDisk path)
    // Lock that exactly so a `>` typo silently re-running the start stage,
    // or a `>` typo silently skipping it, would fail this test.
    for (const startStage of PROJECT_STAGE_ORDER) {
      const resume: ProjectResumePlan = { startStage }
      const startIndex = PROJECT_STAGE_ORDER.indexOf(startStage)
      for (const id of PROJECT_STAGE_ORDER) {
        const stageIndex = PROJECT_STAGE_ORDER.indexOf(id)
        const expected = stageIndex >= startIndex
        assert.equal(
          shouldRunProjectStage(resume, id),
          expected,
          `startStage=${startStage} (#${startIndex}), stage=${id} (#${stageIndex}): expected ${expected}`,
        )
      }
    }
  })

  it("the start stage itself runs (boundary case — easy to break with > vs >=)", () => {
    for (const startStage of PROJECT_STAGE_ORDER) {
      assert.equal(
        shouldRunProjectStage({ startStage }, startStage),
        true,
        `start stage ${startStage} must always run, never skip to resumeFromDisk`,
      )
    }
  })

  it("the stage immediately before startStage is skipped (boundary case)", () => {
    for (let i = 1; i < PROJECT_STAGE_ORDER.length; i++) {
      const startStage = PROJECT_STAGE_ORDER[i]!
      const before = PROJECT_STAGE_ORDER[i - 1]!
      assert.equal(
        shouldRunProjectStage({ startStage }, before),
        false,
        `stage ${before} must be skipped when resuming from ${startStage}`,
      )
    }
  })
})

describe("PROJECT_STAGE_REGISTRY contract", () => {
  it("every node id is unique and matches PROJECT_STAGE_ORDER", () => {
    const registryIds = PROJECT_STAGE_REGISTRY.map(node => node.id)
    assert.deepEqual(registryIds, [...PROJECT_STAGE_ORDER])
    const set = new Set<ProjectStageId>(registryIds)
    assert.equal(set.size, registryIds.length, "duplicate node ids in PROJECT_STAGE_REGISTRY")
  })

  it("every node exposes both run and resumeFromDisk", () => {
    for (const node of PROJECT_STAGE_REGISTRY) {
      assert.equal(typeof node.run, "function", `${node.id}.run must be a function`)
      assert.equal(typeof node.resumeFromDisk, "function", `${node.id}.resumeFromDisk must be a function`)
    }
  })
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  branchNameCandidate,
  branchNameItem,
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "../src/core/branchNames.ts"
import type { WorkflowContext } from "../src/core/workspaceLayout.ts"

const ctx = (overrides: Partial<WorkflowContext> = {}): WorkflowContext => ({
  workspaceId: "ws",
  runId: "run",
  itemSlug: "demo-item",
  baseBranch: "main",
  ...overrides,
})

describe("branchNames", () => {
  it("item / project / wave / story have stable canonical shapes", () => {
    const c = ctx()
    assert.equal(branchNameItem(c), "item/demo-item")
    assert.equal(branchNameProject(c, "P01"), "proj/demo-item__p01")
    assert.equal(branchNameWave(c, "P01", 2), "wave/demo-item__p01__w2")
    assert.equal(branchNameStory(c, "P01", 2, "US-02"), "story/demo-item__p01__w2__us-02")
  })

  it("candidate prefixes the runId so candidates from different runs do not collide", () => {
    const a = branchNameCandidate(ctx({ runId: "run-A" }), "P01")
    const b = branchNameCandidate(ctx({ runId: "run-B" }), "P01")
    assert.notEqual(a, b)
    assert.match(a, /^candidate\/run-a__demo-item__p01$/)
  })

  it("slugifies non-[a-z0-9] characters in projectId and storyId — single canonical name", () => {
    // The point of centralising name construction in branchNames.ts: any caller
    // that fed unslugified ids into a hand-rolled template would produce a name
    // git refuses or, worse, a name that looks valid but mismatches what
    // ensureStoryBranch actually creates. Lock that down here.
    const c = ctx({ itemSlug: "Demo Item!" })
    assert.equal(branchNameItem(c), "item/demo-item")
    assert.equal(branchNameProject(c, "P 01/X"), "proj/demo-item__p-01-x")
    assert.equal(
      branchNameStory(c, "P 01", 2, "US 02/branch.with*chars"),
      "story/demo-item__p-01__w2__us-02-branch-with-chars",
    )
  })

  it("throws when itemSlug is missing — branch ops cannot synthesise a name without it", () => {
    assert.throws(
      () => branchNameItem({ workspaceId: "ws", runId: "r", baseBranch: "main" }),
      /itemSlug is required/,
    )
  })
})

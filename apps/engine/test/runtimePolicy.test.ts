import { test } from "node:test"
import assert from "node:assert/strict"

import { defaultWorkspaceRuntimePolicy } from "../src/core/workspaces.js"
import { reviewerPolicy, stageAuthoringPolicy } from "../src/llm/runtimePolicy.js"

test("qa stage authoring can run verification commands", () => {
  assert.deepEqual(stageAuthoringPolicy(defaultWorkspaceRuntimePolicy(), "qa"), {
    mode: "safe-workspace-write",
  })
})

test("qa reviewer stays read-only", () => {
  assert.deepEqual(reviewerPolicy(defaultWorkspaceRuntimePolicy(), "qa"), {
    mode: "safe-readonly",
  })
})

test("non-qa engineering authoring remains read-only", () => {
  assert.deepEqual(stageAuthoringPolicy(defaultWorkspaceRuntimePolicy(), "project-review"), {
    mode: "safe-readonly",
  })
})

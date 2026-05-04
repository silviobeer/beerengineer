import { test } from "node:test"
import assert from "node:assert/strict"
import { waveBranchName } from "../../../src/core/supabase/branchNaming.js"

test("PROJ-4 PRD-5 US-1: wave branch name follows ownership convention", () => {
  assert.equal(waveBranchName({
    workspace: "Demo Workspace",
    runId: "RUN-1",
    itemId: "ITEM-1",
    projectId: "PROJ-1",
    waveId: "wave-1",
  }), "beerengineer-demo-workspace-run-1-item-1-proj-1-wave-1")
})

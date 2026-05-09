import assert from "node:assert/strict"
import { test } from "node:test"

import { projectBoardPrompts } from "../src/api/boardPromptProjector.js"

test("board prompt projector ignores non-array actions_json payloads", () => {
  const projection = projectBoardPrompts({
    workspace: {
      id: "ws-1",
      key: "alpha",
      root_path: "/tmp/alpha",
      supabase_project_ref: null,
    },
    item: {
      id: "item-1",
      workspace_id: "ws-1",
      code: "ITEM-0001",
      title: "Prompt item",
      description: "summary",
      current_column: "brainstorm",
      phase_status: "running",
      current_stage: "brainstorm",
    },
    openPrompt: { actions_json: "{\"value\":\"promote\"}" },
    projectCount: 0,
  })

  assert.equal(projection.hasOpenPrompt, true)
  assert.equal(projection.hasReviewGateWaiting, false)
})

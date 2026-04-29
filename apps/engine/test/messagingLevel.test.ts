import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { levelOf } from "../src/core/messagingLevel.ts"

describe("messagingLevel", () => {
  it("keeps reviewer agent feedback visible at L1", () => {
    const info = levelOf({
      type: "chat_message",
      runId: "run-1",
      role: "Architecture-Review-LLM",
      source: "reviewer",
      text: "Revise the artifact before continuing.",
    })

    assert.equal(info.type, "agent_message")
    assert.equal(info.level, 1)
  })

  it("keeps ordinary intermediate stage-agent chatter at L0", () => {
    const info = levelOf({
      type: "chat_message",
      runId: "run-1",
      role: "Architecture-LLM",
      source: "stage-agent",
      text: "Intermediate draft.",
    })

    assert.equal(info.type, "agent_message")
    assert.equal(info.level, 0)
  })
})

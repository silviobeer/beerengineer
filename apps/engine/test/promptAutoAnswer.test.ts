import { test } from "node:test"
import assert from "node:assert/strict"

import { busToWorkflowIO, createBus } from "../src/core/bus.js"
import { attachOneShotPromptAnswer } from "../src/core/promptAutoAnswer.js"

test("attachOneShotPromptAnswer answers the next matching structured prompt once", async () => {
  const bus = createBus()
  const io = busToWorkflowIO(bus)
  const detach = attachOneShotPromptAnswer(io, "promote")

  const first = await bus.request("Promote?", {
    runId: "run-1",
    promptId: "prompt-1",
    actions: [
      { label: "Promote", value: "promote" },
      { label: "Cancel", value: "cancel" },
    ],
  })
  assert.equal(first, "promote")

  const second = bus.request("Promote again?", {
    runId: "run-1",
    promptId: "prompt-2",
    actions: [{ label: "Promote", value: "promote" }],
  })
  queueMicrotask(() => bus.answer("prompt-2", "manual"))
  assert.equal(await second, "manual")

  detach()
})

test("attachOneShotPromptAnswer ignores prompts without the requested action", async () => {
  const bus = createBus()
  const io = busToWorkflowIO(bus)
  const detach = attachOneShotPromptAnswer(io, "promote")

  const answer = bus.request("Cancel?", {
    runId: "run-1",
    promptId: "prompt-1",
    actions: [{ label: "Cancel", value: "cancel" }],
  })
  queueMicrotask(() => bus.answer("prompt-1", "cancel"))
  assert.equal(await answer, "cancel")

  detach()
})

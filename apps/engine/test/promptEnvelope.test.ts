import { test } from "node:test"
import assert from "node:assert/strict"

import { buildExecutionPrompt, buildReviewPrompt, buildStagePrompt } from "../src/llm/hosted/promptEnvelope.js"

test("stage prompt preserves the outer JSON contract after externalization", () => {
  const prompt = buildStagePrompt({
    stageId: "planning",
    provider: "codex",
    runtimePolicy: { mode: "safe-workspace-write" },
    request: { kind: "begin", state: { foo: "bar" } },
  })

  assert.match(prompt, /Return exactly one JSON object and nothing else\./)
  assert.match(prompt, /"kind": "artifact"/)
  assert.match(prompt, /Stage: planning/)
  assert.match(prompt, /stageContext/)
  assert.match(prompt, /Return an `artifact` object matching `ImplementationPlanArtifact`:/)
  assert.doesNotMatch(prompt, /implementation-plan-data/)
})

test("review prompt preserves the pass revise block contract and falls back to the default reviewer", () => {
  const prompt = buildReviewPrompt({
    stageId: "documentation",
    provider: "codex",
    runtimePolicy: { mode: "safe-readonly" },
    request: { artifact: { ok: true }, state: { loop: 1 } },
  })

  assert.match(prompt, /Use one of these exact shapes: \{ "kind": "pass" \} \| \{ "kind": "revise", "feedback": string \} \| \{ "kind": "block", "reason": string \}/)
  assert.match(prompt, /reviewContext/)
  assert.match(prompt, /You review the `documentation` stage artifact/)

  const fallbackPrompt = buildReviewPrompt({
    stageId: "execution",
    provider: "codex",
    runtimePolicy: { mode: "safe-readonly" },
    request: { artifact: { ok: true }, state: { loop: 1 } },
  })

  assert.match(fallbackPrompt, /You are a read-only reviewer inside the BeerEngineer workflow engine\./)
})

test("execution prompt loads the external worker prompt and keeps the coder contract inline", () => {
  const prompt = buildExecutionPrompt({
    provider: "codex",
    runtimePolicy: { mode: "unsafe-autonomous-write" },
    storyId: "ITEM-1-P01-US01",
    action: "implement",
    payload: { story: "demo" },
  })

  assert.match(prompt, /You are the bounded implementation worker for one story\./)
  assert.match(prompt, /Modify files directly inside the workspace when required by the task\./)
  assert.match(prompt, /iterationContext/)
  assert.match(prompt, /"summary": string/)
})

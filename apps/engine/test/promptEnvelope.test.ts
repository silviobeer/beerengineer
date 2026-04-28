import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildExecutionPrompt, buildReviewPrompt, buildStagePrompt } from "../src/llm/hosted/promptEnvelope.js"
import { clearPromptCache, PromptLoadError } from "../src/llm/prompts/loader.js"

test("stage prompt preserves the outer JSON contract after externalization", () => {
  const prompt = buildStagePrompt({
    stageId: "planning",
    harness: "codex",
    runtime: "sdk",
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
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "safe-readonly" },
    request: { artifact: { ok: true }, state: { loop: 1 } },
  })

  assert.match(prompt, /Use one of these exact shapes: \{ "kind": "pass" \} \| \{ "kind": "revise", "feedback": string \} \| \{ "kind": "block", "reason": string \}/)
  assert.match(prompt, /reviewContext/)
  assert.match(prompt, /You review the `documentation` stage artifact/)

  const fallbackPrompt = buildReviewPrompt({
    stageId: "execution",
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "safe-readonly" },
    request: { artifact: { ok: true }, state: { loop: 1 } },
  })

  assert.match(fallbackPrompt, /You are a read-only reviewer inside the beerengineer_ workflow engine\./)
})

test("execution prompt loads the external worker prompt and keeps the coder contract inline", () => {
  const prompt = buildExecutionPrompt({
    harness: "codex",
    runtime: "sdk",
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

test("frontend-design, qa, and execution prompts include bundled design references", () => {
  const frontendDesignPrompt = buildStagePrompt({
    stageId: "frontend-design",
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "safe-workspace-write" },
    request: { kind: "begin", state: { foo: "bar" } },
  })
  assert.match(frontendDesignPrompt, /## References/)
  assert.match(frontendDesignPrompt, /Prefer a distinct type pairing/)
  assert.match(frontendDesignPrompt, /Avoid the familiar "single violet accent on off-white" palette/)

  const qaPrompt = buildStagePrompt({
    stageId: "qa",
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "safe-readonly" },
    request: { kind: "begin", state: { foo: "bar" } },
  })
  assert.match(qaPrompt, /## References/)
  assert.match(qaPrompt, /Avoid the familiar "single violet accent on off-white" palette/)
  assert.doesNotMatch(qaPrompt, /Responsive checks are part of QA/)

  const executionPrompt = buildExecutionPrompt({
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "unsafe-autonomous-write" },
    storyId: "ITEM-1-P01-US01",
    action: "implement",
    payload: { story: "demo" },
  })
  assert.match(executionPrompt, /## References/)
  assert.match(executionPrompt, /Interaction polish should survive keyboard and pointer use/)
  assert.doesNotMatch(executionPrompt, /Responsive checks are part of QA/)
})

test("frontend-design review prompt includes the bundled anti-patterns reference", () => {
  const prompt = buildReviewPrompt({
    stageId: "frontend-design",
    harness: "codex",
    runtime: "sdk",
    runtimePolicy: { mode: "safe-readonly" },
    request: { artifact: { ok: true }, state: { loop: 1 } },
  })

  assert.match(prompt, /## References/)
  assert.match(prompt, /Avoid the familiar "single violet accent on off-white" palette/)
})

test("frontend-design review prompt does not fall back to _default when a bundle is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-review-bundle-missing-"))
  mkdirSync(join(dir, "reviewers"), { recursive: true })
  writeFileSync(join(dir, "reviewers", "frontend-design.md"), "# Frontend Design Reviewer\n\nreview body\n", "utf8")
  writeFileSync(join(dir, "reviewers", "_default.md"), "# Default Reviewer\n\ndefault body\n", "utf8")

  const previous = process.env.BEERENGINEER_PROMPTS_DIR
  process.env.BEERENGINEER_PROMPTS_DIR = dir
  clearPromptCache()

  try {
    assert.throws(
      () =>
        buildReviewPrompt({
          stageId: "frontend-design",
          harness: "codex",
          runtime: "sdk",
          runtimePolicy: { mode: "safe-readonly" },
          request: { artifact: { ok: true }, state: { loop: 1 } },
        }),
      (error: unknown) =>
        error instanceof PromptLoadError &&
        error.source === "bundle" &&
        error.kind === "reviewers" &&
        error.id === "design/anti-patterns" &&
        error.missing,
    )
  } finally {
    clearPromptCache()
    if (previous === undefined) delete process.env.BEERENGINEER_PROMPTS_DIR
    else process.env.BEERENGINEER_PROMPTS_DIR = previous
  }
})

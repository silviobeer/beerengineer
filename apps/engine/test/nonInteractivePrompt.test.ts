/**
 * Tests for Bug 2: non-interactive prompt auto-resolution.
 *
 * When a stage emits a clarification prompt and the CLI is running
 * non-interactively (no TTY, stdin closed), the prompt MUST NOT be silently
 * resolved with an empty string. Instead, stageRuntime must fail the stage
 * with a descriptive error that tells the operator how to provide answers.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runStage } from "../src/core/stageRuntime.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "../src/core/constants.js"
import type {
  ReviewAgentAdapter,
  ReviewAgentResponse,
  StageAgentAdapter,
  StageAgentInput,
  StageAgentResponse,
} from "../src/core/adapters.js"

type State = { calls: StageAgentInput<Art>["kind"][] }
type Art = { payload: string }

function withTmpCwd(): { restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "be2-noninteractive-"))
  const prev = process.cwd()
  process.chdir(dir)
  return {
    restore: () => {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

class ScriptedStage implements StageAgentAdapter<State, Art> {
  constructor(private script: StageAgentResponse<Art>[]) {}
  async step(input: StageAgentInput<State>): Promise<StageAgentResponse<Art>> {
    input.state.calls.push(input.kind)
    const next = this.script.shift()
    if (!next) throw new Error("scripted stage: no more responses")
    return next
  }
  getSessionId() { return null }
  setSessionId() {}
}

class ScriptedReviewer implements ReviewAgentAdapter<State, Art> {
  constructor(private script: ReviewAgentResponse[]) {}
  async review(): Promise<ReviewAgentResponse> {
    const next = this.script.shift()
    if (!next) throw new Error("scripted reviewer: no more responses")
    return next
  }
  getSessionId() { return null }
  setSessionId() {}
}

function baseDefinition(opts: {
  stageAgent: StageAgentAdapter<State, Art>
  reviewer: ReviewAgentAdapter<State, Art>
  askUser: (prompt: string) => Promise<string>
}) {
  return {
    stageId: "test-vc",
    stageAgentLabel: "Agent",
    reviewerLabel: "Reviewer",
    workspaceId: "ws-noninteractive",
    runId: "run-noninteractive",
    createInitialState: (): State => ({ calls: [] }),
    stageAgent: opts.stageAgent,
    reviewer: opts.reviewer,
    askUser: opts.askUser,
    async onApproved(artifact: Art) { return artifact },
    async persistArtifacts() {
      return [{ kind: "json" as const, label: "Art", fileName: "art.json", content: '{}' }]
    },
    maxReviews: 2,
  }
}

test("stageRuntime fails with a descriptive error when askUser returns the non-interactive sentinel", async () => {
  // This simulates what ioCli.ts does when stdin closes with no queued answer:
  // it resolves the bus.request() promise with the sentinel value.
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      // First turn: agent asks a clarifying question
      { kind: "message", message: "Do you have wireframe references?" },
      // Second turn should never be reached — stageRuntime must throw before
      // passing the empty/sentinel answer to the agent
      { kind: "artifact", artifact: { payload: "should-not-reach" } },
    ])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])

    // Simulate non-interactive: askUser resolves with the sentinel
    const askUser = async (_prompt: string): Promise<string> => {
      return NON_INTERACTIVE_NO_ANSWER_SENTINEL
    }

    await assert.rejects(
      () => runStage(baseDefinition({ stageAgent: stage, reviewer, askUser })),
      (err: Error) => {
        // Must be our descriptive error, not a cascade from the agent
        assert.match(err.message, /non-interactive/)
        assert.match(err.message, /pending_prompt/)
        // Must not be "scripted stage: no more responses" — the sentinel
        // check must fire before the agent sees the answer
        assert.ok(
          !err.message.includes("scripted stage"),
          `Should have thrown before reaching the agent, got: ${err.message}`,
        )
        return true
      },
    )
  } finally {
    env.restore()
  }
})

test("stageRuntime passes normally when askUser returns a real non-empty answer", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      { kind: "message", message: "Do you have references?" },
      { kind: "artifact", artifact: { payload: "result" } },
    ])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])

    // A proper piped answer (e.g. "none\n" from stdin)
    const askUser = async () => "none"

    const { result } = await runStage(baseDefinition({ stageAgent: stage, reviewer, askUser }))
    assert.equal((result as Art).payload, "result")
  } finally {
    env.restore()
  }
})

test("stageRuntime passes normally when there is no prompt (stage goes straight to artifact)", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      // No message turn — agent goes straight to artifact
      { kind: "artifact", artifact: { payload: "direct" } },
    ])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])

    // askUser should never be called; if it were, it would return sentinel
    const askUser = async () => NON_INTERACTIVE_NO_ANSWER_SENTINEL

    const { result } = await runStage(baseDefinition({ stageAgent: stage, reviewer, askUser }))
    assert.equal((result as Art).payload, "direct")
  } finally {
    env.restore()
  }
})

test("NON_INTERACTIVE_NO_ANSWER_SENTINEL is a non-empty unique string", () => {
  assert.ok(NON_INTERACTIVE_NO_ANSWER_SENTINEL.length > 0)
  // Starts with null byte — cannot be a real user answer
  assert.ok(NON_INTERACTIVE_NO_ANSWER_SENTINEL.startsWith("\0"))
})

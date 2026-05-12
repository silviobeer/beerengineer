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
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus, busToWorkflowIO } from "../src/core/bus.js"
import { BlockedRunError } from "../src/core/blockedError.js"
import { runStage } from "../src/core/stageRuntime.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "../src/core/constants.js"
import { withPromptPersistence } from "../src/core/promptPersistence.js"
import { runWithActiveRun, withStageLifecycle } from "../src/core/runContext.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { layout } from "../src/core/workspaceLayout.js"
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

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-noninteractive-db-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  return {
    db,
    cleanup: () => {
      db.close()
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
    workspaceRoot: process.cwd(),
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
        assert.match(err.message, /pending[_ ]prompt/i)
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

test("non-interactive unanswered prompts block the run and keep the prompt open", async () => {
  const env = withTmpCwd()
  const db = tmpDb()
  try {
    const repos = new Repos(db.db)
    const workspace = repos.upsertWorkspace({ key: "test", name: "Test", rootPath: process.cwd() })
    const item = repos.createItem({ workspaceId: workspace.id, title: "T", description: "D" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title })
    const bus = createBus()
    const io = busToWorkflowIO(bus)
    const detachPromptPersistence = withPromptPersistence(bus, repos)

    bus.subscribe(event => {
      if (event.type === "prompt_requested") {
        bus.answer(event.promptId, NON_INTERACTIVE_NO_ANSWER_SENTINEL)
      }
    })

    const stage = new ScriptedStage([
      { kind: "message", message: "Do you have wireframe references?" },
      { kind: "artifact", artifact: { payload: "should-not-reach" } },
    ])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])

    await assert.rejects(
      () =>
        runWithWorkflowIO(io, () =>
          runWithActiveRun({ runId: run.id, itemId: item.id, title: item.title }, () =>
            runStage(baseDefinition({
              stageAgent: stage,
              reviewer,
              askUser: prompt => io.ask(prompt),
            })),
          ),
        ),
      /non-interactive/,
    )

    const prompt = repos.getOpenPrompt(run.id)
    assert.ok(prompt, "expected the unanswered prompt to remain open")
    assert.equal(prompt?.prompt, "Do you have wireframe references?")
    assert.equal(repos.getOpenPrompt(run.id)?.id, prompt?.id)
    assert.equal(repos.getOpenPrompt(run.id)?.id, prompt?.id)
    assert.equal(repos.getPendingPrompt(prompt!.id)?.answered_at, null)

    const ctx = { workspaceId: "ws-noninteractive", workspaceRoot: process.cwd(), runId: "run-noninteractive" }
    const runSnapshot = JSON.parse(readFileSync(layout.runFile(ctx), "utf8")) as { status: string; currentStage: string }
    assert.equal(runSnapshot.status, "blocked")
    assert.equal(runSnapshot.currentStage, "test-vc")

    detachPromptPersistence()
    io.close()
  } finally {
    env.restore()
    db.cleanup()
  }
})

test("withStageLifecycle does not emit a failed stage completion for intentional blocks", async () => {
  const events: Array<{ type: string; status?: string }> = []

  await assert.rejects(
    () =>
      runWithWorkflowIO(
        {
          async ask() {
            throw new Error("should not ask")
          },
          emit(event) {
            events.push({ type: event.type, status: "status" in event ? event.status : undefined })
          },
        },
        () =>
          runWithActiveRun({ runId: "run-1", itemId: "item-1", title: "T" }, () =>
            withStageLifecycle("requirements", async () => {
              throw new BlockedRunError("blocked")
            }),
          ),
      ),
    /blocked/,
  )

  assert.ok(events.some(event => event.type === "stage_started"))
  assert.equal(
    events.some(event => event.type === "stage_completed" && event.status === "failed"),
    false,
  )
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

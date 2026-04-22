import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runStage } from "../src/core/stageRuntime.js"
import type {
  ReviewAgentAdapter,
  ReviewAgentResponse,
  StageAgentAdapter,
  StageAgentInput,
  StageAgentResponse,
} from "../src/core/adapters.js"
import { layout } from "../src/core/workspaceLayout.js"

type State = { calls: StageAgentInput<Art>["kind"][]; userMessages: string[] }
type Art = { payload: string }

function makeState(): State {
  return { calls: [], userMessages: [] }
}

class ScriptedStage implements StageAgentAdapter<State, Art> {
  constructor(private script: StageAgentResponse<Art>[]) {}
  async step(input: StageAgentInput<State>): Promise<StageAgentResponse<Art>> {
    input.state.calls.push(input.kind)
    if (input.kind === "user-message") input.state.userMessages.push(input.userMessage)
    const next = this.script.shift()
    if (!next) throw new Error("scripted stage: no more responses")
    return next
  }
}

class ScriptedReviewer implements ReviewAgentAdapter<State, Art> {
  constructor(private script: ReviewAgentResponse[]) {}
  async review(): Promise<ReviewAgentResponse> {
    const next = this.script.shift()
    if (!next) throw new Error("scripted reviewer: no more responses")
    return next
  }
}

function withTmpCwd(): { restore: () => void; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "be2-stageruntime-"))
  const prev = process.cwd()
  process.chdir(dir)
  return {
    dir,
    restore: () => {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function baseDefinition(overrides: {
  stageAgent: StageAgentAdapter<State, Art>
  reviewer: ReviewAgentAdapter<State, Art>
  maxReviews?: number
  onApproved?: (art: Art) => Promise<string>
  askUser?: (p: string) => Promise<string>
}) {
  return {
    stageId: "testing",
    stageAgentLabel: "Tester",
    reviewerLabel: "Reviewer",
    workspaceId: "ws-1",
    runId: "run-1",
    createInitialState: makeState,
    stageAgent: overrides.stageAgent,
    reviewer: overrides.reviewer,
    askUser: overrides.askUser ?? (async () => "user-answer"),
    showMessage: () => {},
    async onApproved(artifact: Art) {
      return (overrides.onApproved ? overrides.onApproved(artifact) : Promise.resolve(artifact.payload))
    },
    async persistArtifacts() {
      return [
        { kind: "json" as const, label: "Artifact", fileName: "artifact.json", content: '{"ok":true}' },
      ]
    },
    maxReviews: overrides.maxReviews ?? 2,
  }
}

test("happy path: begin -> artifact -> review pass -> approved", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([{ kind: "artifact", artifact: { payload: "done" } }])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])
    const { result, run } = await runStage(baseDefinition({ stageAgent: stage, reviewer }))

    assert.equal(result, "done")
    assert.equal(run.status, "approved")
    assert.equal(run.reviewIteration, 1)
    assert.equal(run.files.length, 1)
    const statuses = run.logs.filter(l => l.type === "status_changed").map(l => l.message)
    assert.deepEqual(statuses, [
      "Status -> chat_in_progress",
      "Status -> artifact_ready",
      "Status -> in_review",
      "Status -> approved",
    ])
  } finally {
    env.restore()
  }
})

test("message loop: begin -> message -> user-message -> artifact", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      { kind: "message", message: "Question 1?" },
      { kind: "artifact", artifact: { payload: "answered" } },
    ])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])
    const answers = ["my answer"]
    const { run } = await runStage(
      baseDefinition({
        stageAgent: stage,
        reviewer,
        askUser: async () => answers.shift()!,
      }),
    )

    assert.equal(run.iteration, 1)
    assert.equal(run.status, "approved")
    const statuses = run.logs.filter(l => l.type === "status_changed").map(l => l.message)
    assert.ok(statuses.includes("Status -> waiting_for_user"))
    assert.ok(run.logs.some(l => l.type === "user_message" && l.message === "my answer"))
  } finally {
    env.restore()
  }
})

test("revise -> chat_in_progress -> artifact -> pass", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      { kind: "artifact", artifact: { payload: "v1" } },
      { kind: "artifact", artifact: { payload: "v2" } },
    ])
    const reviewer = new ScriptedReviewer([
      { kind: "revise", feedback: "please sharpen" },
      { kind: "pass" },
    ])

    const state = makeState()
    const def = baseDefinition({ stageAgent: stage, reviewer })
    def.createInitialState = () => state

    const { result, run } = await runStage(def)

    assert.equal(result, "v2")
    assert.equal(run.reviewIteration, 2)
    assert.deepEqual(state.calls, ["begin", "review-feedback"])
    const statuses = run.logs.filter(l => l.type === "status_changed").map(l => l.message)
    assert.deepEqual(statuses, [
      "Status -> chat_in_progress",
      "Status -> artifact_ready",
      "Status -> in_review",
      "Status -> revision_requested",
      "Status -> artifact_ready",
      "Status -> in_review",
      "Status -> approved",
    ])
    assert.ok(run.logs.some(l => l.type === "review_revise"))
    assert.ok(run.logs.some(l => l.type === "review_pass"))
  } finally {
    env.restore()
  }
})

test("max reviews reached -> blocked, throws", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([
      { kind: "artifact", artifact: { payload: "v1" } },
      { kind: "artifact", artifact: { payload: "v2" } },
    ])
    const reviewer = new ScriptedReviewer([
      { kind: "revise", feedback: "nope" },
      { kind: "revise", feedback: "nope again" },
    ])

    await assert.rejects(
      () => runStage(baseDefinition({ stageAgent: stage, reviewer, maxReviews: 2 })),
      /Blocked: no pass after 2 reviews/,
    )
  } finally {
    env.restore()
  }
})

test("reviewer returns block -> throws reason immediately", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([{ kind: "artifact", artifact: { payload: "v1" } }])
    const reviewer = new ScriptedReviewer([{ kind: "block", reason: "unrecoverable" }])

    await assert.rejects(
      () => runStage(baseDefinition({ stageAgent: stage, reviewer })),
      /unrecoverable/,
    )
  } finally {
    env.restore()
  }
})

test("blocked review persists blocked status to workspace, run, and stage files", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([{ kind: "artifact", artifact: { payload: "v1" } }])
    const reviewer = new ScriptedReviewer([{ kind: "block", reason: "unrecoverable" }])

    await assert.rejects(
      () => runStage(baseDefinition({ stageAgent: stage, reviewer })),
      /unrecoverable/,
    )

    const ctx = { workspaceId: "ws-1", runId: "run-1" }
    const wsFile = JSON.parse(await readFile(layout.workspaceFile(ctx.workspaceId), "utf8"))
    assert.equal(wsFile.status, "blocked")
    assert.equal(wsFile.currentStage, "testing")

    const runFile = JSON.parse(await readFile(layout.runFile(ctx), "utf8"))
    assert.equal(runFile.status, "blocked")
    assert.equal(runFile.currentStage, "testing")

    const stageFile = JSON.parse(await readFile(layout.stageRunFile(ctx, "testing"), "utf8"))
    assert.equal(stageFile.status, "blocked")
  } finally {
    env.restore()
  }
})

test("persistence writes workspace.json, run.json, stage run.json and log.jsonl", async () => {
  const env = withTmpCwd()
  try {
    const stage = new ScriptedStage([{ kind: "artifact", artifact: { payload: "ok" } }])
    const reviewer = new ScriptedReviewer([{ kind: "pass" }])
    await runStage(baseDefinition({ stageAgent: stage, reviewer }))

    const ctx = { workspaceId: "ws-1", runId: "run-1" }
    const wsFile = JSON.parse(await readFile(layout.workspaceFile(ctx.workspaceId), "utf8"))
    assert.equal(wsFile.id, "ws-1")
    assert.equal(wsFile.currentStage, "testing")
    assert.equal(wsFile.status, "approved")

    const runFile = JSON.parse(await readFile(layout.runFile(ctx), "utf8"))
    assert.equal(runFile.status, "approved")

    const stageFile = JSON.parse(await readFile(layout.stageRunFile(ctx, "testing"), "utf8"))
    assert.equal(stageFile.stage, "testing")
    assert.equal(stageFile.status, "approved")

    const logText = await readFile(layout.stageLogFile(ctx, "testing"), "utf8")
    const lines = logText.trim().split("\n").map(l => JSON.parse(l))
    assert.ok(lines.some(l => l.type === "status_changed" && l.message.endsWith("approved")))
    assert.ok(lines.some(l => l.type === "artifact_created"))
    assert.ok(lines.some(l => l.type === "file_written"))
  } finally {
    env.restore()
  }
})

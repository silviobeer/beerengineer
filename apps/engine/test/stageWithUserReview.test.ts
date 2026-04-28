import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  ReviewAgentAdapter,
  ReviewAgentResponse,
  StageAgentAdapter,
  StageAgentInput,
  StageAgentResponse,
} from "../src/core/adapters.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "../src/core/constants.js"
import { runStageWithUserReview, type RevisableState } from "../src/core/stageWithUserReview.js"

type Artifact = { value: string }
type State = RevisableState & { seenRevisionFeedback?: string }

class StaticStage implements StageAgentAdapter<State, Artifact> {
  async step(input: StageAgentInput<State>): Promise<StageAgentResponse<Artifact>> {
    input.state.seenRevisionFeedback = input.state.pendingRevisionFeedback
    return { kind: "artifact", artifact: { value: input.state.pendingRevisionFeedback ?? "v1" } }
  }
  getSessionId(): string | null { return null }
  setSessionId(_sessionId: string | null): void {}
}

class StaticReviewer implements ReviewAgentAdapter<State, Artifact> {
  constructor(private readonly response: ReviewAgentResponse = { kind: "pass" }) {}
  async review(): Promise<ReviewAgentResponse> {
    return this.response
  }
  getSessionId(): string | null { return null }
  setSessionId(_sessionId: string | null): void {}
}

function withTmpCwd(): { restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "be2-user-review-"))
  const prev = process.cwd()
  process.chdir(dir)
  return {
    restore: () => {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function makeState(revisionFeedback?: string, reviewRound = 0): State {
  return {
    history: [],
    clarificationCount: 0,
    maxClarifications: 0,
    pendingRevisionFeedback: revisionFeedback,
    userReviewRound: reviewRound,
  }
}

test("invalid review reply re-prompts until explicit approve", async () => {
  const env = withTmpCwd()
  try {
    const prompts: string[] = []
    const answers = ["looks good", "approve"]
    let approvals = 0

    const result = await runStageWithUserReview<State, Artifact, Artifact>({
      stageId: "visual-companion",
      stageAgentLabel: "UX Designer",
      reviewerLabel: "UX Review",
      workspaceId: "ws-1",
      workspaceRoot: process.cwd(),
      baseRunId: "run-1",
      stageAgent: new StaticStage(),
      reviewer: new StaticReviewer(),
      askUser: async (prompt) => {
        prompts.push(prompt)
        return answers.shift() ?? "approve"
      },
      buildFreshState: ({ revisionFeedback, reviewRound }) => makeState(revisionFeedback, reviewRound),
      async persistArtifacts() {
        return [{ kind: "json" as const, label: "Artifact", fileName: "artifact.json", content: "{}" }]
      },
      buildGatePrompt: () => "approve or revise",
      async onUserApprove({ artifact }) {
        approvals++
        return artifact
      },
      maxReviews: 1,
    })

    assert.equal(result.value, "v1")
    assert.equal(approvals, 1)
    assert.equal(prompts.length, 2)
  } finally {
    env.restore()
  }
})

test("non-interactive sentinel at review gate throws instead of approving", async () => {
  const env = withTmpCwd()
  try {
    await assert.rejects(
      () => runStageWithUserReview<State, Artifact, Artifact>({
        stageId: "frontend-design",
        stageAgentLabel: "Visual Designer",
        reviewerLabel: "Design Review",
        workspaceId: "ws-1",
        workspaceRoot: process.cwd(),
        baseRunId: "run-1",
        stageAgent: new StaticStage(),
        reviewer: new StaticReviewer(),
        askUser: async () => NON_INTERACTIVE_NO_ANSWER_SENTINEL,
        buildFreshState: ({ revisionFeedback, reviewRound }) => makeState(revisionFeedback, reviewRound),
        async persistArtifacts() {
          return [{ kind: "json" as const, label: "Artifact", fileName: "artifact.json", content: "{}" }]
        },
        buildGatePrompt: () => "approve or revise",
        async onUserApprove({ artifact }) {
          return artifact
        },
        maxReviews: 1,
      }),
      (err: Error) => {
        assert.match(err.message, /non-interactive run/)
        assert.match(err.message, /pending_prompt/)
        assert.match(err.message, /approve/)
        return true
      },
    )
  } finally {
    env.restore()
  }
})

test("revise feedback loops back into the next stage iteration", async () => {
  const env = withTmpCwd()
  try {
    const answers = ["revise: tighter spacing", "approve"]
    const seenFeedback: Array<string | undefined> = []

    const result = await runStageWithUserReview<State, Artifact, Artifact>({
      stageId: "frontend-design",
      stageAgentLabel: "Visual Designer",
      reviewerLabel: "Design Review",
      workspaceId: "ws-1",
      workspaceRoot: process.cwd(),
      baseRunId: "run-1",
      stageAgent: new StaticStage(),
      reviewer: new StaticReviewer(),
      askUser: async () => answers.shift() ?? "approve",
      buildFreshState: ({ revisionFeedback, reviewRound }) => {
        seenFeedback.push(revisionFeedback)
        return makeState(revisionFeedback, reviewRound)
      },
      async persistArtifacts() {
        return [{ kind: "json" as const, label: "Artifact", fileName: "artifact.json", content: "{}" }]
      },
      buildGatePrompt: () => "approve or revise",
      async onUserApprove({ artifact }) {
        return artifact
      },
      maxReviews: 1,
    })

    assert.equal(result.value, "tighter spacing")
    assert.deepEqual(seenFeedback, [undefined])
  } finally {
    env.restore()
  }
})

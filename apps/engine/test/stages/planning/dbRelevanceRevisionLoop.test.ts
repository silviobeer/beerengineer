import { mkdtempSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import type { ReviewAgentAdapter, ReviewAgentResponse, StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../../src/core/adapters.js"
import { runStage } from "../../../src/core/stageRuntime.js"
import { layout } from "../../../src/core/workspaceLayout.js"
import { createPlanningReviewer } from "../../../src/stages/planning/index.js"
import type { ImplementationPlanArtifact, WaveDefinition } from "../../../src/types.js"

type LoopState = { reviewFeedbacks: string[] }

function featureWave(input: Partial<WaveDefinition> & Pick<WaveDefinition, "id" | "number" | "stories">): WaveDefinition {
  return {
    goal: input.goal ?? input.id,
    kind: "feature",
    stories: input.stories,
    dbRelevantStoryCount: input.dbRelevantStoryCount,
    dbRelevantWave: input.dbRelevantWave,
    internallyParallelizable: input.internallyParallelizable ?? false,
    dependencies: input.dependencies ?? [],
    exitCriteria: input.exitCriteria ?? [],
    ...input,
  }
}

function plan(waves: WaveDefinition[]): ImplementationPlanArtifact {
  return {
    project: { id: "PROJ-19", name: "Planner Output Validation" },
    conceptSummary: "concept",
    architectureSummary: "architecture",
    plan: {
      summary: "Preserve planner-authored summary",
      assumptions: ["Assume stable scope"],
      sequencingNotes: ["Preserve sequencing"],
      dependencies: ["W1 before W2"],
      risks: ["Preserve risks"],
      waves,
    },
  }
}

function cloneArtifact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

class SequencedPlanningStage implements StageAgentAdapter<LoopState, ImplementationPlanArtifact> {
  constructor(private readonly artifacts: ImplementationPlanArtifact[]) {}

  async step(input: StageAgentInput<LoopState>): Promise<StageAgentResponse<ImplementationPlanArtifact>> {
    if (input.kind === "review-feedback") {
      input.state.reviewFeedbacks.push(input.reviewFeedback)
    }
    if (input.kind === "user-message") {
      throw new Error("planning loop test stage does not accept user input")
    }
    const next = this.artifacts.shift()
    if (!next) throw new Error("planning loop test stage ran out of artifacts")
    return { kind: "artifact", artifact: cloneArtifact(next) }
  }
}

class PassReviewer implements ReviewAgentAdapter<LoopState, ImplementationPlanArtifact> {
  calls = 0

  async review(): Promise<ReviewAgentResponse> {
    this.calls++
    return { kind: "pass" }
  }
}

function withTmpWorkspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "be2-planning-db-loop-"))
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

async function runPlanningLoop(artifacts: ImplementationPlanArtifact[]) {
  const env = withTmpWorkspace()
  const state: LoopState = { reviewFeedbacks: [] }
  const stage = new SequencedPlanningStage(artifacts)
  const innerReviewer = new PassReviewer()
  const reviewer = createPlanningReviewer(innerReviewer, {
    validate: () => null,
    dbRelevanceContext: { hasSupabaseConfigured: true },
  })

  try {
    const result = await runStage({
      stageId: "planning-db-loop-test",
      stageAgentLabel: "Planner",
      reviewerLabel: "Planning Reviewer",
      workspaceId: "ws-1",
      workspaceRoot: env.root,
      runId: "run-1",
      createInitialState: () => state,
      stageAgent: stage,
      reviewer,
      askUser: async () => "",
      async persistArtifacts(_run, artifact) {
        return [
          {
            kind: "json" as const,
            label: "Implementation Plan JSON",
            fileName: "implementation-plan.json",
            content: JSON.stringify(artifact, null, 2),
          },
        ]
      },
      async onApproved(artifact, run) {
        await writeFile(join(run.stageArtifactsDir, "implementation-plan.json"), JSON.stringify(artifact, null, 2))
        return artifact
      },
      maxReviews: 4,
    })

    const persistedPath = join(layout.stageArtifactsDir({ workspaceId: "ws-1", workspaceRoot: env.root, runId: "run-1" }, "planning-db-loop-test"), "implementation-plan.json")
    const persistedArtifact = JSON.parse(await readFile(persistedPath, "utf8")) as ImplementationPlanArtifact
    return { ...result, state, innerReviewer, persistedArtifact }
  } finally {
    env.cleanup()
  }
}

test("REQ-2 TC-1 / TC-2 / TC-3: unsupported positives trigger targeted revision feedback and a valid first revision publishes directly", async () => {
  const initial = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Implement backend API handler", dbRelevant: true },
        { id: "US-2", title: "Confirm Supabase readiness", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
    }),
  ])
  const revised = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Implement backend API handler", dbRelevant: false },
        { id: "US-2", title: "Add users table migration for Postgres", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])

  const { result, run, state, innerReviewer, persistedArtifact } = await runPlanningLoop([initial, revised])

  assert.equal(state.reviewFeedbacks.length, 1)
  assert.match(state.reviewFeedbacks[0]!, /US-1/)
  assert.match(state.reviewFeedbacks[0]!, /US-2/)
  assert.match(state.reviewFeedbacks[0]!, /dbRelevantWave:true/)
  assert.equal(run.reviewIteration, 2)
  assert.equal(innerReviewer.calls, 1)
  assert.equal(result.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(result.plan.waves[0]?.stories[1]?.dbRelevant, true)
  assert.equal(persistedArtifact.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(persistedArtifact.plan.waves[0]?.stories[1]?.dbRelevant, true)
})

test("REQ-2 TC-4 / TC-7: second-round feedback includes only still-unsupported claims and second revision can publish directly", async () => {
  const initial = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Implement backend API handler", dbRelevant: true },
        { id: "US-2", title: "Confirm Supabase readiness", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
    }),
  ])
  const partialRepair = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Add audit table migration for Postgres", dbRelevant: true },
        { id: "US-2", title: "Confirm Supabase readiness", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
    }),
  ])
  const secondRepair = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Add audit table migration for Postgres", dbRelevant: true },
        { id: "US-2", title: "Add users table migration for Postgres", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
    }),
  ])

  const { result, run, state, innerReviewer } = await runPlanningLoop([initial, partialRepair, secondRepair])

  assert.equal(state.reviewFeedbacks.length, 2)
  assert.match(state.reviewFeedbacks[0]!, /US-1/)
  assert.match(state.reviewFeedbacks[0]!, /US-2/)
  assert.match(state.reviewFeedbacks[1]!, /US-2/)
  assert.doesNotMatch(state.reviewFeedbacks[1]!, /US-1/)
  assert.equal(run.reviewIteration, 3)
  assert.equal(innerReviewer.calls, 1)
  assert.equal(result.plan.waves[0]?.stories[0]?.dbRelevant, true)
  assert.equal(result.plan.waves[0]?.stories[1]?.dbRelevant, true)
})

test("REQ-2 TC-5 / TC-8: retry loop stops after two revision rounds and fallback clears only the remaining unsupported positives", async () => {
  const initial = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Implement backend API handler", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
    featureWave({
      id: "W2",
      number: 2,
      goal: "Deliver billing storage changes",
      stories: [
        { id: "US-2", title: "Add billing table migration for Postgres", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])
  const firstRevision = cloneArtifact(initial)
  const secondRevision = cloneArtifact(initial)

  const { result, run, state, innerReviewer, persistedArtifact } = await runPlanningLoop([initial, firstRevision, secondRevision])

  assert.equal(state.reviewFeedbacks.length, 2)
  assert.equal(run.reviewIteration, 3)
  assert.equal(innerReviewer.calls, 1)
  assert.equal(result.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(result.plan.waves[0]?.dbRelevantWave, false)
  assert.equal(result.plan.waves[1]?.stories[0]?.dbRelevant, true)
  assert.equal(result.plan.waves[1]?.dbRelevantWave, true)
  assert.equal(persistedArtifact.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(persistedArtifact.plan.waves[0]?.dbRelevantWave, false)
  assert.equal(persistedArtifact.plan.waves[1]?.stories[0]?.dbRelevant, true)
  assert.equal(persistedArtifact.plan.summary, initial.plan.summary)
})

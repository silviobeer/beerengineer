import { test } from "node:test"
import assert from "node:assert/strict"

import { enforceWaveParallelism } from "../src/core/planValidator.js"
import type { ImplementationPlanArtifact } from "../src/types.js"

function basePlan(): ImplementationPlanArtifact {
  return {
    project: { id: "P01", name: "test" },
    conceptSummary: "c",
    architectureSummary: "a",
    plan: {
      summary: "s",
      assumptions: [],
      sequencingNotes: [],
      dependencies: [],
      risks: [],
      waves: [],
    },
  }
}

test("enforceWaveParallelism: stories with overlapping sharedFiles forces sequential", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "parallel-eligible but overlapping",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: ["package.json", "src/a.ts"] },
        { id: "US-02", title: "b", sharedFiles: ["package.json", "src/b.ts"] },
      ],
      internallyParallelizable: true,
      dependencies: [],
      exitCriteria: [],
    },
  ]
  const events: Array<Record<string, unknown>> = []
  const decisions = enforceWaveParallelism(plan, { emit: e => events.push(e), runId: "run-1" })
  assert.equal(decisions.length, 1)
  assert.equal(plan.plan.waves[0].internallyParallelizable, false, "wave was downgraded")
  assert.deepEqual(decisions[0].overlappingFiles, ["package.json"])
  assert.equal(decisions[0].cause, "shared_file_overlap")
  assert.deepEqual(decisions[0].stories, ["US-01", "US-02"])
  assert.equal(events.length, 1)
  assert.equal(events[0].type, "wave_serialized")
  assert.equal(events[0].waveId, "W1")
  assert.deepEqual(events[0].overlappingFiles, ["package.json"])
})

test("enforceWaveParallelism: disjoint sharedFiles preserves internallyParallelizable: true", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "fully disjoint",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: ["src/a.ts"] },
        { id: "US-02", title: "b", sharedFiles: ["src/b.ts"] },
      ],
      internallyParallelizable: true,
      dependencies: [],
      exitCriteria: [],
    },
  ]
  const events: Array<Record<string, unknown>> = []
  const decisions = enforceWaveParallelism(plan, { emit: e => events.push(e) })
  assert.equal(decisions.length, 0)
  assert.equal(plan.plan.waves[0].internallyParallelizable, true, "no overlap → remains parallel")
  assert.equal(events.length, 0, "no event when no override")
})

test("enforceWaveParallelism: missing sharedFiles is treated as overlap-unknown → forced sequential", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "incomplete metadata",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: ["src/a.ts"] },
        { id: "US-02", title: "b" }, // no sharedFiles declared
      ],
      internallyParallelizable: true,
      dependencies: [],
      exitCriteria: [],
    },
  ]
  const events: Array<Record<string, unknown>> = []
  const decisions = enforceWaveParallelism(plan, { emit: e => events.push(e) })
  assert.equal(decisions.length, 1)
  assert.equal(plan.plan.waves[0].internallyParallelizable, false)
  assert.equal(decisions[0].cause, "missing_shared_files")
  assert.deepEqual(decisions[0].overlappingFiles, [])
  assert.equal(events[0]!.cause, "missing_shared_files")
})

test("enforceWaveParallelism: empty sharedFiles arrays are treated as missing", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "all empty",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: [] },
        { id: "US-02", title: "b", sharedFiles: [] },
      ],
      internallyParallelizable: true,
      dependencies: [],
      exitCriteria: [],
    },
  ]
  const decisions = enforceWaveParallelism(plan, { emit: () => {} })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].cause, "missing_shared_files")
  assert.equal(plan.plan.waves[0].internallyParallelizable, false)
})

test("enforceWaveParallelism: setup waves are unaffected (always sequential)", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "scaffold",
      kind: "setup",
      stories: [],
      tasks: [
        {
          id: "scaffold",
          title: "scaffold",
          sharedFiles: ["package.json"],
          contract: { expectedFiles: [], requiredScripts: [], postChecks: [] },
        },
      ],
      internallyParallelizable: false,
      dependencies: [],
      exitCriteria: [],
    },
    {
      id: "W2",
      number: 2,
      goal: "feature",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: ["src/a.ts"] },
        { id: "US-02", title: "b", sharedFiles: ["src/b.ts"] },
      ],
      internallyParallelizable: true,
      dependencies: ["W1"],
      exitCriteria: [],
    },
  ]
  const decisions = enforceWaveParallelism(plan, { emit: () => {} })
  // Setup wave is skipped; feature wave with disjoint files is preserved.
  assert.equal(decisions.length, 0)
  assert.equal(plan.plan.waves[0].internallyParallelizable, false)
  assert.equal(plan.plan.waves[1].internallyParallelizable, true)
})

test("enforceWaveParallelism: waves already marked sequential are passed through", () => {
  const plan = basePlan()
  plan.plan.waves = [
    {
      id: "W1",
      number: 1,
      goal: "sequential by intent",
      kind: "feature",
      stories: [
        { id: "US-01", title: "a", sharedFiles: ["package.json"] },
        { id: "US-02", title: "b", sharedFiles: ["package.json"] },
      ],
      internallyParallelizable: false,
      dependencies: [],
      exitCriteria: [],
    },
  ]
  const decisions = enforceWaveParallelism(plan, { emit: () => {} })
  assert.equal(decisions.length, 0, "no event/override when planner already chose sequential")
  assert.equal(plan.plan.waves[0].internallyParallelizable, false)
})

test("fake planner produces a kind:'setup' wave first with scaffold ownership", async () => {
  const { FakePlanningStageAdapter } = await import("../src/llm/fake/planningStage.js")
  const project = { id: "P01", name: "test", description: "d", concept: { summary: "s", problem: "p", users: [], constraints: [] } }
  const stage = new FakePlanningStageAdapter(project)
  const state = {
    projectId: "P01",
    prd: { stories: [{ id: "US-01", title: "x", acceptanceCriteria: [] }, { id: "US-02", title: "y", acceptanceCriteria: [] }] },
    architectureSummary: { summary: "A", systemShape: "shape", constraints: [], relevantComponents: [], decisions: [] },
    revisionCount: 0,
  } as never
  const out = await stage.step({ kind: "begin", state })
  assert.equal(out.kind, "artifact")
  if (out.kind === "artifact") {
    const setup = out.artifact.plan.waves[0]
    assert.equal(setup.kind, "setup")
    assert.equal(setup.number, 1)
    assert.deepEqual(setup.dependencies, [])
    assert.equal(setup.internallyParallelizable, false)
    assert.ok(setup.tasks && setup.tasks.length > 0, "setup wave must have at least one task")
    const scaffoldOwned = setup.tasks![0]!.sharedFiles
    // Setup owns the canonical scaffold files.
    for (const expected of ["package.json", "tsconfig.json", ".gitignore"]) {
      assert.ok(scaffoldOwned.includes(expected), `setup task should own ${expected}`)
    }
    // No feature story should redeclare scaffold files in its own
    // sharedFiles — that is the contract Fix 4 enforces in the prompt
    // and the fake planner mirrors.
    const featureStorySharedFiles = out.artifact.plan.waves
      .filter(w => w.kind === "feature")
      .flatMap(w => w.stories.flatMap(s => s.sharedFiles ?? []))
    for (const owned of scaffoldOwned) {
      assert.ok(!featureStorySharedFiles.includes(owned), `feature story should not redeclare scaffold-owned ${owned}`)
    }
  }
})

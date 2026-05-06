import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  evaluateSupabaseReadinessForExecutionPlan,
  formatSupabaseReadinessBlockedCliOutput,
  recordSupabaseReadinessBlockedRun,
} from "../src/core/supabase/preExecutionReadiness.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import type { ImplementationPlanArtifact, WaveDefinition } from "../src/types.js"

function wave(input: Partial<WaveDefinition> & Pick<WaveDefinition, "id" | "number" | "stories">): WaveDefinition {
  return {
    goal: input.goal ?? input.id,
    kind: input.kind ?? "feature",
    dbRelevantStoryCount: input.dbRelevantStoryCount,
    dbRelevantWave: input.dbRelevantWave,
    tasks: input.tasks,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
    ...input,
  }
}

function plan(waves: WaveDefinition[]): ImplementationPlanArtifact {
  return {
    project: { id: "PROJ", name: "Project" },
    conceptSummary: "concept",
    architectureSummary: "architecture",
    plan: {
      summary: "plan",
      assumptions: [],
      sequencingNotes: [],
      dependencies: [],
      risks: [],
      waves,
    },
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-execution-gate-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: join(dir, "repo") })
  const item = repos.createItem({ workspaceId: workspace.id, title: "DB Item", description: "needs db" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "cli" })
  return { dir, db, repos, workspace, item, run }
}

test("PROJ-6 PRD-1 US-1: later DB-relevant waves invoke readiness before execution side effects", async () => {
  let readinessCalls = 0
  const result = await evaluateSupabaseReadinessForExecutionPlan({
    plan: plan([
      wave({ id: "W1", number: 1, stories: [{ id: "US-1", title: "copy", dbRelevant: false }], dbRelevantWave: false }),
      wave({ id: "W2", number: 2, stories: [{ id: "US-2", title: "schema", dbRelevant: true }], dbRelevantWave: true }),
    ]),
    evaluateReadiness: async trigger => {
      readinessCalls += 1
      return {
        status: "blocked",
        missingSetupActions: ["Store management token"],
        retry: { available: true, runId: "run-1" },
        workspace: { key: "alpha" },
        dbRelevanceTrigger: trigger,
      }
    },
  })

  assert.equal(readinessCalls, 1)
  assert.equal(result.status, "blocked")
  assert.deepEqual(result.dbRelevanceTrigger, { waveId: "W2", waveNumber: 2, storyId: "US-2" })
})

test("PROJ-6 PRD-1 US-1: explicitly non-DB plans bypass readiness and malformed metadata blocks", async () => {
  let readinessCalls = 0
  const nonDb = await evaluateSupabaseReadinessForExecutionPlan({
    plan: plan([
      wave({ id: "W1", number: 1, stories: [{ id: "US-1", title: "copy", dbRelevant: false }], dbRelevantWave: false }),
    ]),
    evaluateReadiness: async () => {
      readinessCalls += 1
      throw new Error("must not be called")
    },
  })

  assert.equal(nonDb.status, "ready")
  assert.equal(readinessCalls, 0)

  const malformed = await evaluateSupabaseReadinessForExecutionPlan({
    plan: plan([
      wave({ id: "W1", number: 1, stories: [{ id: "US-1", title: "legacy" }], dbRelevantWave: undefined }),
    ]),
    evaluateReadiness: async () => {
      throw new Error("must not be called")
    },
  })

  assert.equal(malformed.status, "blocked")
  assert.match(malformed.message ?? "", /dbRelevant/)
})

test("PROJ-6 PRD-1 US-4: readiness blocker marks the same run blocked and retry updates the payload", async () => {
  const ctx = fixture()
  try {
    const first = recordSupabaseReadinessBlockedRun({
      repos: ctx.repos,
      runId: ctx.run.id,
      readiness: {
        status: "blocked",
        missingSetupActions: ["Store management token", "Connect Supabase project"],
        retry: { available: true, runId: ctx.run.id },
        workspace: { key: "alpha" },
        dbRelevanceTrigger: { waveId: "W2", waveNumber: 2, storyId: "US-2" },
      },
    })
    assert.equal(first.id, ctx.run.id)
    assert.equal(ctx.repos.getRun(ctx.run.id)?.status, "blocked")
    assert.equal(ctx.repos.getRun(ctx.run.id)?.recovery_status, "blocked")
    assert.equal(ctx.repos.listRuns().length, 1)

    recordSupabaseReadinessBlockedRun({
      repos: ctx.repos,
      runId: ctx.run.id,
      readiness: {
        status: "blocked",
        missingSetupActions: ["Create persistent test branch"],
        retry: { available: true, runId: ctx.run.id },
        workspace: { key: "alpha" },
        dbRelevanceTrigger: { waveId: "W2", waveNumber: 2, storyId: "US-2" },
      },
    })
    const updated = ctx.repos.getRun(ctx.run.id)
    assert.equal(updated?.id, ctx.run.id)
    assert.match(updated?.recovery_summary ?? "", /Create persistent test branch/)
    assert.equal(ctx.repos.listRuns().length, 1)
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-1: CLI blocker output is concise and keeps retry separate", () => {
  const output = formatSupabaseReadinessBlockedCliOutput({
    itemRef: "ITEM-0001",
    action: "start_implementation",
    runId: "run-1",
    readiness: {
      status: "blocked",
      missingSetupActions: [
        "Store management token",
        "Connect Supabase project",
        "Create persistent test branch",
      ],
      retry: { available: true, runId: "run-1" },
      workspace: { key: "alpha" },
      dbRelevanceTrigger: { waveId: "W2", waveNumber: 2, storyId: "US-2" },
    },
  })

  assert.match(output, /Workspace: alpha/)
  assert.match(output, /planned DB-relevant waves require Supabase readiness before execution workers start/)
  assert.match(output, /Missing setup actions:/)
  assert.match(output, /Store management token/)
  assert.match(output, /beerengineer setup/)
  assert.match(output, /Retry: beerengineer item action --item ITEM-0001 --action start_implementation/)
  assert.doesNotMatch(output, /full manual Supabase tutorial/i)
  assert.equal(/^.*Retry run.*$/m.test(output), false)
})

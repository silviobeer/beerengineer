import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBus, busToWorkflowIO, type EventBus } from "../src/core/bus.js"
import { attachRunSubscribers } from "../src/core/runSubscribers.js"
import type { WorkflowEvent } from "../src/core/io.js"
import { projectStageLogRow } from "../src/core/messagingProjection.js"
import { performExplicitReplan, type PersistedImplementationPlanArtifact } from "../src/core/replan.js"
import { handleReplanRun } from "../src/api/routes/runs.js"
import { buildSupabaseReadinessRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { supabaseHandoffPath } from "../src/core/supabase/handoffWriter.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos, type RunRow } from "../src/db/repositories.js"
import type { ArchitectureArtifact, ImplementationPlanArtifact, PRD, Project } from "../src/types.js"

function workflowContext(root: string, workspaceId: string, runId: string): WorkflowContext {
  return {
    workspaceId,
    workspaceRoot: root,
    runId,
  }
}

function buildPlan(input: {
  summary: string
  waves: Array<{
    id: string
    number: number
    goal: string
    storyIds: string[]
    dbRelevantWave?: boolean
  }>
}): ImplementationPlanArtifact {
  return {
    project: {
      id: "proj-1",
      name: "Project One",
    },
    conceptSummary: "Stable replan concept",
    architectureSummary: "Run control owns plan replacement.",
    plan: {
      summary: input.summary,
      assumptions: ["Upstream context remains approved."],
      sequencingNotes: ["Replans replace the active plan only after preparation succeeds."],
      dependencies: ["requirements", "architecture"],
      risks: ["Replacement plan may reorder work."],
      waves: input.waves.map(wave => ({
        id: wave.id,
        number: wave.number,
        goal: wave.goal,
        kind: "feature",
        stories: wave.storyIds.map(storyId => ({
          id: storyId,
          title: `${storyId} title`,
          dbRelevant: wave.dbRelevantWave === true,
          sharedFiles: [`apps/engine/${storyId}.ts`],
        })),
        dbRelevantStoryCount: wave.dbRelevantWave === true ? wave.storyIds.length : 0,
        dbRelevantWave: wave.dbRelevantWave ?? false,
        internallyParallelizable: false,
        dependencies: wave.number === 1 ? [] : [input.waves[wave.number - 2]?.id ?? "W1"],
        exitCriteria: [`Wave ${wave.number} complete.`],
      })),
    },
  }
}

async function seedPlanArtifacts(ctx: WorkflowContext, plan: ImplementationPlanArtifact): Promise<void> {
  const planningDir = layout.stageArtifactsDir(ctx, "planning")
  mkdirSync(planningDir, { recursive: true })
  await writeFile(
    join(planningDir, "implementation-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  )
  await writeFile(
    join(planningDir, "implementation-plan.md"),
    `# ${plan.project.name}\n\n${plan.plan.summary}\n`,
  )
}

async function seedApprovedUpstreamContext(ctx: WorkflowContext): Promise<void> {
  const brainstormDir = layout.stageArtifactsDir(ctx, "brainstorm")
  const requirementsDir = layout.stageArtifactsDir(ctx, "requirements")
  const architectureDir = layout.stageArtifactsDir(ctx, "architecture")
  mkdirSync(brainstormDir, { recursive: true })
  mkdirSync(requirementsDir, { recursive: true })
  mkdirSync(architectureDir, { recursive: true })

  const projects: Project[] = [{
    id: "proj-1",
    name: "Project One",
    description: "Project for replan testing",
    concept: {
      summary: "Operator-visible replan",
      problem: "Plans need safe replacement",
      users: ["operators"],
      constraints: ["single run row"],
    },
  }]
  const prd: PRD = {
    stories: [
      {
        id: "REQ-1",
        title: "First story",
        acceptanceCriteria: [{ id: "AC-1", text: "Do the first thing", priority: "must", category: "functional" }],
      },
      {
        id: "REQ-2",
        title: "Second story",
        acceptanceCriteria: [{ id: "AC-2", text: "Do the second thing", priority: "must", category: "functional" }],
      },
    ],
  }
  const architecture: ArchitectureArtifact = {
    project: {
      id: "proj-1",
      name: "Project One",
      description: "Project for replan testing",
    },
    concept: {
      summary: "Operator-visible replan",
      problem: "Plans need safe replacement",
      users: ["operators"],
      constraints: ["single run row"],
    },
    prdSummary: {
      storyCount: 2,
      storyIds: ["REQ-1", "REQ-2"],
    },
    architecture: {
      summary: "Run control owns explicit replan.",
      systemShape: "Single-process engine.",
      components: [{ name: "Run Service", responsibility: "Coordinates explicit replan." }],
      dataModelNotes: [],
      apiNotes: [],
      deploymentNotes: [],
      constraints: ["Do not auto-resume."],
      risks: [],
      openQuestions: [],
    },
  }

  await writeFile(join(brainstormDir, "projects.json"), `${JSON.stringify(projects, null, 2)}\n`)
  await writeFile(join(requirementsDir, "prd.json"), `${JSON.stringify({ prd }, null, 2)}\n`)
  await writeFile(join(architectureDir, "architecture.json"), `${JSON.stringify(architecture, null, 2)}\n`)
}

function makeBus(): { bus: EventBus; io: ReturnType<typeof busToWorkflowIO>; events: WorkflowEvent[] } {
  const bus = createBus()
  const events: WorkflowEvent[] = []
  bus.subscribe(event => events.push(event))
  return { bus, io: busToWorkflowIO(bus), events }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-replan-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Replan Item", description: "swap plans safely" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    status: "blocked",
    workspaceFsId: "replan-run",
  })
  const ctx = workflowContext(dir, "replan-run", run.id)

  mkdirSync(layout.runDir(ctx), { recursive: true })
  mkdirSync(layout.executionWaveDir(ctx, 1), { recursive: true })
  mkdirSync(layout.handoffDir(ctx), { recursive: true })
  mkdirSync(join(layout.artefactsRoot(dir), "handoff", "supabase", run.id), { recursive: true })

  return {
    dir,
    db,
    repos,
    workspace,
    item,
    run,
    ctx,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function seedBlockedExecutionState(input: ReturnType<typeof fixture>, run?: RunRow): Promise<void> {
  const currentRun = run ?? input.run
  input.repos.updateRun(currentRun.id, {
    status: "blocked",
    current_stage: "execution",
    recovery_status: "blocked",
    recovery_scope: "story",
    recovery_scope_ref: "1/REQ-1",
    recovery_summary: "Blocked on stale execution references.",
    recovery_payload_json: buildSupabaseReadinessRecoveryPayload({
      status: "blocked",
      missingSetupActions: [],
      retry: { available: true, runId: currentRun.id },
      workspace: {
        id: input.workspace.id,
        key: input.workspace.key,
        rootPath: input.dir,
        projectRef: "proj_alpha",
      },
      dbRelevanceTrigger: { waveId: "W1", waveNumber: 1, storyId: "REQ-1" },
      message: "Replacement plan should clear stale wave references.",
    }),
  })
  await writeFile(
    join(layout.executionWaveDir(input.ctx, 1), "wave-summary.json"),
    `${JSON.stringify({ waveId: "W1", storyIds: ["REQ-1"] }, null, 2)}\n`,
  )
  await writeFile(layout.handoffFile(input.ctx, "proj-1"), "{\n  \"status\": \"old\"\n}\n")
  await writeFile(supabaseHandoffPath(input.dir, currentRun.id, "W1"), "SUPABASE_URL=https://old.example\n")
}

test("successful explicit replan namespaces same-structure waves, archives prior artifacts, and clears stale recovery references", async () => {
  const f = fixture()
  try {
    const currentPlan = buildPlan({
      summary: "Original plan",
      waves: [
        { id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"], dbRelevantWave: true },
        { id: "W2", number: 2, goal: "Original wave two", storyIds: ["REQ-2"] },
      ],
    })
    await seedPlanArtifacts(f.ctx, currentPlan)
    await seedBlockedExecutionState(f)

    const { bus, io, events } = makeBus()
    const detach = attachRunSubscribers(bus, f.repos, { runId: f.run.id, itemId: f.item.id })
    try {
      await performExplicitReplan({
        repos: f.repos,
        io,
        runId: f.run.id,
        reason: "Scope changed after operator review.",
        generatePlan: async () => buildPlan({
          summary: "Replacement plan",
          waves: [
            { id: "W1", number: 1, goal: "Replacement wave one", storyIds: ["REQ-1"], dbRelevantWave: true },
            { id: "W2", number: 2, goal: "Replacement wave two", storyIds: ["REQ-2"] },
          ],
        }),
      })
    } finally {
      detach()
    }

    const persisted = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
    ) as PersistedImplementationPlanArtifact
    assert.equal(persisted.metadata?.activePlan.version, 2)
    assert.deepEqual(
      persisted.plan.waves.map(wave => wave.id),
      ["W1--r2", "W2--r2"],
    )
    assert.equal(persisted.metadata?.history.length, 1)
    assert.equal(persisted.metadata?.history[0]?.reason, "Scope changed after operator review.")
    assert.deepEqual(
      persisted.metadata?.history[0]?.before.waves.map(wave => wave.id),
      ["W1", "W2"],
    )
    assert.deepEqual(
      persisted.metadata?.history[0]?.after.waves.map(wave => wave.id),
      ["W1--r2", "W2--r2"],
    )

    const archiveEntries = persisted.metadata?.history[0]?.archivedArtifacts ?? []
    assert.ok(archiveEntries.some(entry => entry.kind === "execution-waves"), JSON.stringify(archiveEntries))
    assert.ok(archiveEntries.some(entry => entry.kind === "handoffs"), JSON.stringify(archiveEntries))
    assert.ok(archiveEntries.some(entry => entry.kind === "supabase-handoff"), JSON.stringify(archiveEntries))
    assert.ok(archiveEntries.some(entry => entry.kind === "planning-json"), JSON.stringify(archiveEntries))

    const archivedPlanPath = archiveEntries.find(entry => entry.kind === "planning-json")?.archivedPath
    assert.ok(archivedPlanPath && existsSync(archivedPlanPath), archivedPlanPath ?? "missing archived plan json")
    assert.equal(existsSync(join(layout.executionWaveDir(f.ctx, 1), "wave-summary.json")), false)
    assert.equal(existsSync(layout.handoffFile(f.ctx, "proj-1")), false)
    assert.equal(existsSync(supabaseHandoffPath(f.dir, f.run.id, "W1")), false)

    const updatedRun = f.repos.getRun(f.run.id)
    assert.equal(updatedRun?.recovery_scope, "run")
    assert.equal(updatedRun?.recovery_scope_ref, null)
    assert.equal(updatedRun?.recovery_payload_json, null)

    const regeneratedEvents = events.filter((event): event is Extract<WorkflowEvent, { type: "plan_regenerated" }> => event.type === "plan_regenerated")
    assert.equal(regeneratedEvents.length, 1)
    assert.equal(regeneratedEvents[0]?.reason, "Scope changed after operator review.")
    assert.deepEqual(
      regeneratedEvents[0]?.before.waves.map(wave => wave.id),
      ["W1", "W2"],
    )
    assert.deepEqual(
      regeneratedEvents[0]?.after.waves.map(wave => wave.id),
      ["W1--r2", "W2--r2"],
    )

    const loggedEvents = f.repos.listLogsForRun(f.run.id).filter(log => log.event_type === "plan_regenerated")
    assert.equal(loggedEvents.length, 1)
    const projected = projectStageLogRow(loggedEvents[0]!)
    assert.equal(projected?.type, "plan_regenerated")
    assert.equal(projected?.payload.reason, "Scope changed after operator review.")
  } finally {
    f.close()
  }
})

test("successful explicit replan records before/after metadata for changed wave structure", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [
        { id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] },
        { id: "W2", number: 2, goal: "Original wave two", storyIds: ["REQ-2"] },
      ],
    }))

    const { bus, io } = makeBus()
    const detach = attachRunSubscribers(bus, f.repos, { runId: f.run.id, itemId: f.item.id })
    try {
      await performExplicitReplan({
        repos: f.repos,
        io,
        runId: f.run.id,
        reason: "Operator requested a new wave split.",
        generatePlan: async () => buildPlan({
          summary: "Replacement plan",
          waves: [
            { id: "W1", number: 1, goal: "Reworked first wave", storyIds: ["REQ-1"] },
            { id: "W2", number: 2, goal: "Inserted second wave", storyIds: ["REQ-2"] },
            { id: "W3", number: 3, goal: "New trailing wave", storyIds: ["REQ-3"] },
          ],
        }),
      })
    } finally {
      detach()
    }

    const persisted = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
    ) as PersistedImplementationPlanArtifact
    const history = persisted.metadata?.history[0]
    assert.ok(history, "expected replan history entry")
    assert.equal(history?.before.waveCount, 2)
    assert.equal(history?.after.waveCount, 3)
    assert.deepEqual(
      history?.after.waves.map(wave => wave.id),
      ["W1--r2", "W2--r2", "W3--r2"],
    )
  } finally {
    f.close()
  }
})

test("replan failure during replacement generation leaves the original plan active and records no success event", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [{ id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] }],
    }))
    await seedBlockedExecutionState(f)
    const before = await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8")

    const { bus, io } = makeBus()
    const detach = attachRunSubscribers(bus, f.repos, { runId: f.run.id, itemId: f.item.id })
    try {
      await assert.rejects(
        performExplicitReplan({
          repos: f.repos,
          io,
          runId: f.run.id,
          reason: "Should fail early.",
          generatePlan: async () => {
            throw new Error("planner exploded")
          },
        }),
        /planner exploded/,
      )
    } finally {
      detach()
    }

    assert.equal(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
      before,
    )
    assert.equal(existsSync(join(layout.executionWaveDir(f.ctx, 1), "wave-summary.json")), true)
    assert.equal(existsSync(layout.handoffFile(f.ctx, "proj-1")), true)
    assert.equal(f.repos.listLogsForRun(f.run.id).filter(log => log.event_type === "plan_regenerated").length, 0)
  } finally {
    f.close()
  }
})

test("late abort after replacement preparation keeps the original plan active and leaves no partial swap visible", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [{ id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] }],
    }))
    await seedBlockedExecutionState(f)
    const before = await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8")

    const { bus, io } = makeBus()
    const detach = attachRunSubscribers(bus, f.repos, { runId: f.run.id, itemId: f.item.id })
    try {
      await assert.rejects(
        performExplicitReplan({
          repos: f.repos,
          io,
          runId: f.run.id,
          reason: "Abort after preparation.",
          generatePlan: async () => buildPlan({
            summary: "Replacement plan",
            waves: [{ id: "W1", number: 1, goal: "Replacement wave one", storyIds: ["REQ-9"] }],
          }),
          hooks: {
            afterPreparation: async () => {
              throw new Error("abort before activation")
            },
          },
        }),
        /abort before activation/,
      )
    } finally {
      detach()
    }

    assert.equal(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
      before,
    )
    assert.equal(existsSync(join(layout.executionWaveDir(f.ctx, 1), "wave-summary.json")), true)
    assert.equal(existsSync(layout.handoffFile(f.ctx, "proj-1")), true)
    assert.equal(existsSync(supabaseHandoffPath(f.dir, f.run.id, "W1")), true)
    assert.equal(existsSync(join(layout.runDir(f.ctx), "replans")), false)
    assert.equal(f.repos.listLogsForRun(f.run.id).filter(log => log.event_type === "plan_regenerated").length, 0)
  } finally {
    f.close()
  }
})

test("POST /runs/:id/replan regenerates the replacement plan from persisted upstream artifacts", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [
        { id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] },
        { id: "W2", number: 2, goal: "Original wave two", storyIds: ["REQ-2"] },
      ],
    }))
    await seedApprovedUpstreamContext(f.ctx)
    await seedBlockedExecutionState(f)

    const server = createServer((req, res) => {
      void handleReplanRun(f.repos, req, res, f.run.id)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    assert.ok(address && typeof address === "object")

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Operator requested replanning from the API." }),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { runId: f.run.id, status: "replanned" })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }

    const persisted = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
    ) as PersistedImplementationPlanArtifact
    assert.equal(persisted.metadata.activePlan.version, 2)
    assert.deepEqual(
      persisted.plan.waves.map(wave => wave.id),
      ["W1--r2", "W2--r2", "W3--r2"],
    )
    assert.equal(f.repos.listLogsForRun(f.run.id).filter(log => log.event_type === "plan_regenerated").length, 1)
  } finally {
    f.close()
  }
})

test("POST /runs/:id/replan rejects missing and blank reasons, but accepts padded non-blank input", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [
        { id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] },
        { id: "W2", number: 2, goal: "Original wave two", storyIds: ["REQ-2"] },
      ],
    }))
    await seedApprovedUpstreamContext(f.ctx)
    const before = await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8")

    const server = createServer((req, res) => {
      void handleReplanRun(f.repos, req, res, f.run.id)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    assert.ok(address && typeof address === "object")

    try {
      for (const body of [{}, { reason: "" }, { reason: "   " }]) {
        const response = await fetch(`http://127.0.0.1:${address.port}/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
        assert.equal(response.status, 422)
        assert.deepEqual(await response.json(), {
          error: "reason_required",
          message: "Replan reason is required.",
        })
      }

      const padded = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "  deploy hotfix  " }),
      })
      assert.equal(padded.status, 200)
      assert.deepEqual(await padded.json(), { runId: f.run.id, status: "replanned" })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }

    const persisted = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
    ) as PersistedImplementationPlanArtifact
    assert.equal(persisted.metadata.activePlan.version, 2)
    assert.notEqual(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
      before,
    )
  } finally {
    f.close()
  }
})

test("POST /runs/:id/replan rejects runs that have not produced a plan yet", async () => {
  const f = fixture()
  try {
    const server = createServer((req, res) => {
      void handleReplanRun(f.repos, req, res, f.run.id)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    assert.ok(address && typeof address === "object")

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Need a new plan shape." }),
      })
      assert.equal(response.status, 409)
      assert.deepEqual(await response.json(), {
        error: "replan_plan_missing",
        message: "Run has no persisted plan to replan yet.",
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }

    assert.equal(f.repos.getRun(f.run.id)?.id, f.run.id)
    assert.equal(existsSync(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json")), false)
  } finally {
    f.close()
  }
})

test("POST /runs/:id/replan returns the documented 409 payload for an actively running run and leaves the active plan unchanged", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [{ id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] }],
    }))
    const before = await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8")
    const heartbeatAt = Date.now()
    f.repos.updateRun(f.run.id, { status: "running", current_stage: "planning", recovery_status: null, recovery_scope: null, recovery_scope_ref: null, recovery_summary: null, recovery_payload_json: null })
    claimWorkerLease(f.repos, {
      runId: f.run.id,
      workerInstanceId: "api-fresh",
      workerOwnerKind: "api",
      now: heartbeatAt,
    })

    const server = createServer((req, res) => {
      void handleReplanRun(f.repos, req, res, f.run.id)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    assert.ok(address && typeof address === "object")

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Operator wants a replan now." }),
      })
      assert.equal(response.status, 409)
      assert.deepEqual(await response.json(), {
        error: "replan_run_active",
        currentStatus: "running",
        workerHeartbeatAt: new Date(heartbeatAt).toISOString(),
        hint: "Use POST /runs/:runId/block-now to pause, then replan.",
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }

    assert.equal(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
      before,
    )
  } finally {
    f.close()
  }
})

test("POST /runs/:id/replan accepts stale-heartbeat running runs and keeps the same run identity", async () => {
  const f = fixture()
  try {
    await seedPlanArtifacts(f.ctx, buildPlan({
      summary: "Original plan",
      waves: [
        { id: "W1", number: 1, goal: "Original wave one", storyIds: ["REQ-1"] },
        { id: "W2", number: 2, goal: "Original wave two", storyIds: ["REQ-2"] },
      ],
    }))
    await seedApprovedUpstreamContext(f.ctx)
    f.repos.updateRun(f.run.id, { status: "running", current_stage: "planning", recovery_status: null, recovery_scope: null, recovery_scope_ref: null, recovery_summary: null, recovery_payload_json: null })
    claimWorkerLease(f.repos, {
      runId: f.run.id,
      workerInstanceId: "api-stale",
      workerOwnerKind: "api",
      now: Date.now() - 120_000,
    })

    const server = createServer((req, res) => {
      void handleReplanRun(f.repos, req, res, f.run.id)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    assert.ok(address && typeof address === "object")

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Worker heartbeat is stale; replace the plan." }),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { runId: f.run.id, status: "replanned" })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }

    const persisted = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(f.ctx, "planning"), "implementation-plan.json"), "utf8"),
    ) as PersistedImplementationPlanArtifact
    assert.equal(persisted.metadata.activePlan.version, 2)
    assert.equal(f.repos.getRun(f.run.id)?.id, f.run.id)
  } finally {
    f.close()
  }
})

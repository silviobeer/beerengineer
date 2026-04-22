import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "../src/core/io.js"
import { runWorkflow } from "../src/workflow.ts"
import { layout } from "../src/core/workspaceLayout.js"
import type { SimulatedRepoState } from "../src/types.js"

function makeIO(answers: {
  brainstorm: string[]
  requirements: string[]
  qa: string
  handoff: string
}): { io: WorkflowIO; events: WorkflowEvent[]; promptLog: string[] } {
  const events: WorkflowEvent[] = []
  const promptLog: string[] = []
  // The runtime prompt text is always "  you > "; use the preceding showMessage flow
  // via a counter-based mapping: brainstorm uses 4 asks, requirements 3, qa 1, handoff 1.
  let brainstormIdx = 0
  let requirementsIdx = 0
  let phase: "brainstorm" | "requirements" | "qa" | "handoff" = "brainstorm"
  let brainstormAsks = 0
  let requirementsAsks = 0
  const io: WorkflowIO = {
    async ask(prompt) {
      promptLog.push(prompt)
      if (prompt.startsWith("  Test, merge")) return answers.handoff
      // phase progression by ask count
      if (phase === "brainstorm") {
        const answer = answers.brainstorm[brainstormIdx++] ?? "ok"
        brainstormAsks++
        if (brainstormAsks >= answers.brainstorm.length) phase = "requirements"
        return answer
      }
      if (phase === "requirements") {
        const answer = answers.requirements[requirementsIdx++] ?? "ok"
        requirementsAsks++
        if (requirementsAsks >= answers.requirements.length) phase = "qa"
        return answer
      }
      if (phase === "qa") {
        phase = "handoff"
        return answers.qa
      }
      return answers.handoff
    },
    emit(event) {
      events.push(event)
    },
  }
  return { io, events, promptLog }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-e2e-"))
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
}

test("runWorkflow runs end-to-end with all review/side loops, producing artifacts", async () => {
  await withTmpCwd(async () => {
    const originalLog = console.log
    console.log = () => {}

    const { io, events } = makeIO({
      brainstorm: [
        "User needs structured workflow.",
        "Target audience: solo-operator teams.",
        "Constraint: single-node, no cloud access.",
        "Yes, constraints are stable enough.",
      ],
      requirements: [
        "Focus: core workflow as input form.",
        "Status badges per entry.",
        "US-02 clearer: filter by status.",
      ],
      qa: "accept",
      handoff: "test",
    })

    try {
      await runWithWorkflowIO(io, () =>
        runWorkflow({ id: "i-1", title: "Test Workflow", description: "smoke" }),
      )
    } finally {
      console.log = originalLog
    }

    // brainstorm produced concept + projects
    const ctx = { workspaceId: "test-workflow-i-1", runId: "" }
    const wsDir = layout.workspaceDir(ctx.workspaceId)
    const wsJson = JSON.parse(await readFile(layout.workspaceFile(ctx.workspaceId), "utf8"))
    ctx.runId = wsJson.currentRunId
    assert.ok(ctx.runId, "workspace.json must record currentRunId")

    const concept = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "brainstorm"), "concept.json"), "utf8"),
    )
    assert.equal(typeof concept.summary, "string")

    const prd = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "requirements"), "prd.json"), "utf8"),
    )
    assert.equal(prd.prd.stories.length, 3)

    const plan = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json"), "utf8"),
    )
    assert.equal(plan.plan.waves.length, 2)
    assert.equal(plan.plan.waves[0].stories.length, 1)
    assert.equal(plan.plan.waves[1].parallel, true)

    const qaReport = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "qa"), "qa-report.json"), "utf8"),
    )
    assert.equal(qaReport.accepted, true)

    const doc = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "documentation"), "documentation.json"), "utf8"),
    )
    assert.equal(doc.project.id, "P01")

    // wave summaries exist — every story must reach a terminal status
    const wave1 = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 1), "utf8"))
    const wave2 = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 2), "utf8"))
    assert.equal(wave1.storiesMerged.length, 1, "wave 1 (sequential) should merge US-01")
    assert.equal(wave1.storiesBlocked.length, 0)
    assert.equal(wave2.storiesMerged.length, 2, "wave 2 (parallel) should merge both stories")
    assert.equal(wave2.storiesBlocked.length, 0, "wave 2 must not silently block any story")

    const repoState = JSON.parse(
      await readFile(layout.repoStateWorkspaceFile(ctx.workspaceId), "utf8"),
    ) as SimulatedRepoState
    assert.equal(repoState.branches.find(branch => branch.name === "story/p01-us-02")?.status, "merged")
    assert.equal(repoState.branches.find(branch => branch.name === "story/p01-us-03")?.status, "merged")
    assert.equal(repoState.branches.find(branch => branch.name === "proj/p01")?.commits.length, 3)

    // handoff file created with merge decision
    const handoffPath = layout.handoffFile(ctx, "P01")
    const handoff = JSON.parse(await readFile(handoffPath, "utf8"))
    assert.equal(handoff.decision, "test")
    assert.equal(handoff.candidateBranch.status, "open")
    assert.match(handoff.candidateBranch.name, /^pr\//)

    // With the event-bus model, stages emit presentation + chat_message
    // events even when no run context is active; the bare IO just captures
    // them. Presence of those events verifies the bus path is wired; the
    // lack of lifecycle events (run_started/stage_started) verifies
    // runWorkflow still tolerates no run-context.
    assert.ok(events.length > 0, "expected stage events to flow through the bus")
    assert.equal(
      events.filter(e => e.type === "run_started" || e.type === "stage_started").length,
      0,
      "no lifecycle events when run context is not active",
    )

    // workspace.json currentStage is the last stage we ran (handoff)
    const finalWs = JSON.parse(await readFile(layout.workspaceFile(ctx.workspaceId), "utf8"))
    assert.equal(finalWs.status, "approved", "last stage status propagated to workspace")
  })
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { busToWorkflowIO } from "../src/core/runOrchestrator.js"
import { prepareForegroundIdeaRun } from "../src/core/runService.js"
import { loadResumeReadiness } from "../src/core/resume.js"
import type { WorkflowEvent } from "../src/core/io.js"

function seedCleanGitRepo(root: string): void {
  mkdirSync(root, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: root, encoding: "utf8" })
}

function makePromptingIo(): { io: ReturnType<typeof busToWorkflowIO> & { bus: ReturnType<typeof createBus> }; events: WorkflowEvent[] } {
  const brainstormAnswers = [
    "User needs structured workflow.",
    "Target audience: solo-operator teams.",
    "Constraint: single-node, no cloud access.",
    "Yes, constraints are stable enough.",
  ]
  const requirementsAnswers = [
    "Focus: core workflow as input form.",
    "Status badges per entry.",
    "US-02 clearer: filter by status.",
  ]
  let brainstormIdx = 0
  let requirementsIdx = 0
  let promptCount = 0

  const events: WorkflowEvent[] = []
  const bus = createBus()
  bus.subscribe(event => {
    events.push(event)
    if (event.type !== "prompt_requested") return

    promptCount += 1
    if (promptCount > 80) {
      throw new Error(`Unexpected prompt loop after ${promptCount} prompts; last prompt: ${event.prompt}`)
    }

    let answer: string
    if (event.prompt.startsWith("Promote ")) answer = "promote"
    else if (/wireframes or mockups/i.test(event.prompt)) answer = "none"
    else if (/screens or flows/i.test(event.prompt)) answer = "dashboard first"
    else if (/accessibility, responsive, or interaction constraints/i.test(event.prompt)) answer = "WCAG AA required"
    else if (/^Wireframe summary/i.test(event.prompt)) answer = "approve"
    else if (/design system, brand direction, or reference apps/i.test(event.prompt)) answer = "none"
    else if (/visual tone or product preference/i.test(event.prompt)) answer = "professional"
    else if (/hard constraints on color, typography, density, accessibility, or responsiveness/i.test(event.prompt)) {
      answer = "no brand constraints"
    } else if (/^Design summary/i.test(event.prompt)) answer = "approve"
    else if (/^Reviewer findings:/i.test(event.prompt)) answer = "accept"
    else if (/^What problem|^Who is|^What is the core value|^What constraints|^Why are/i.test(event.prompt)) {
      answer = brainstormAnswers[brainstormIdx++] ?? "ok"
    } else if (/^Which feature|^Which action|^Which important boundary/i.test(event.prompt)) {
      answer = requirementsAnswers[requirementsIdx++] ?? "ok"
    } else if (/^Which story or AC should I sharpen/i.test(event.prompt)) {
      answer = requirementsAnswers[requirementsIdx++] ?? "US-02 acceptance criteria"
    } else {
      throw new Error(`Unexpected workflow prompt: ${event.prompt}`)
    }

    bus.emit({ type: "prompt_answered", runId: event.runId, promptId: event.promptId, answer })
  })

  return { io: { ...busToWorkflowIO(bus), bus }, events }
}

test("CLI-owned run stops at a recoverable execution handoff after planning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-execution-boundary-"))
  const repoRoot = join(dir, "repo")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  try {
    seedCleanGitRepo(repoRoot)
    repos.upsertWorkspace({ key: "test", name: "Test", rootPath: repoRoot })
    const { io, events } = makePromptingIo()

    const prepared = prepareForegroundIdeaRun(repos, io, {
      title: "CLI-owned boundary",
      description: "Stop before execution starts",
      workspaceKey: "test",
      owner: "cli",
    })

    if (!prepared.ok) {
      assert.fail("expected prepareForegroundIdeaRun to succeed")
    }
    await prepared.start()

    const run = repos.getRun(prepared.runId)
    if (!run) {
      assert.fail("expected persisted run after foreground start")
    }
    assert.equal(run.owner, "cli")
    assert.equal(run.worker_owner_kind, "cli")
    assert.equal(run.current_stage, "planning")
    assert.equal(run.status, "blocked")
    assert.equal(run.recovery_status, "blocked")
    assert.equal(run.recovery_scope, "stage")
    assert.equal(run.recovery_scope_ref, "execution")
    assert.match(run.recovery_summary ?? "", /API worker ownership/i)

    const startedStages = events
      .filter((event): event is Extract<WorkflowEvent, { type: "stage_started" }> => event.type === "stage_started")
      .map(event => event.stageKey)

    assert.ok(startedStages.includes("brainstorm"))
    assert.ok(startedStages.includes("requirements"))
    assert.ok(startedStages.includes("architecture"))
    assert.ok(startedStages.includes("planning"))
    assert.equal(startedStages.includes("execution"), false)

    const blocked = events.filter((event): event is Extract<WorkflowEvent, { type: "run_blocked" }> => event.type === "run_blocked")
    assert.equal(blocked.length, 1)
    assert.equal(blocked[0]?.scope.type, "stage")
    assert.equal(blocked[0]?.scope.stageId, "execution")

    const readiness = await loadResumeReadiness(repos, prepared.runId)
    assert.equal(readiness.kind, "ready")
    if (readiness.kind !== "ready") return
    assert.equal(readiness.record.scope.type, "stage")
    if (readiness.record.scope.type !== "stage") return
    assert.equal(readiness.record.scope.stageId, "execution")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

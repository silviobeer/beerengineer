import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { busToWorkflowIO, prepareRun } from "../src/core/runOrchestrator.js"
import { prepareForegroundIdeaRun } from "../src/core/runService.js"
import { claimExecutionOwnershipHandoffs } from "../src/core/executionOwnershipHandoff.js"
import { markRunFailedRecoverable } from "../src/core/orphanRecovery.js"
import { recoveryUserMessageForRun, LOST_WORKER_USER_MESSAGE } from "../src/core/recoveryUserMessage.js"
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

type PromptingState = {
  brainstormAnswers: string[]
  requirementsAnswers: string[]
  brainstormIdx: number
  requirementsIdx: number
}

const STATIC_PROMPT_ANSWERS: Array<{ matches: RegExp | ((prompt: string) => boolean); answer: string }> = [
  { matches: prompt => prompt.startsWith("Promote "), answer: "promote" },
  { matches: /wireframes or mockups/i, answer: "none" },
  { matches: /screens or flows/i, answer: "dashboard first" },
  { matches: /accessibility, responsive, or interaction constraints/i, answer: "WCAG AA required" },
  { matches: /^Wireframe summary/i, answer: "approve" },
  { matches: /design system, brand direction, or reference apps/i, answer: "none" },
  { matches: /visual tone or product preference/i, answer: "professional" },
  {
    matches: /hard constraints on color, typography, density, accessibility, or responsiveness/i,
    answer: "no brand constraints",
  },
  { matches: /^Design summary/i, answer: "approve" },
  { matches: /^Reviewer findings:/i, answer: "accept" },
]

function promptMatches(prompt: string, matcher: RegExp | ((prompt: string) => boolean)): boolean {
  return typeof matcher === "function" ? matcher(prompt) : matcher.test(prompt)
}

function answerPrompt(prompt: string, state: PromptingState): string {
  const staticAnswer = STATIC_PROMPT_ANSWERS.find(entry => promptMatches(prompt, entry.matches))
  if (staticAnswer) return staticAnswer.answer
  if (/^What problem|^Who is|^What is the core value|^What constraints|^Why are/i.test(prompt)) {
    return state.brainstormAnswers[state.brainstormIdx++] ?? "ok"
  }
  if (/^Which feature|^Which action|^Which important boundary/i.test(prompt)) {
    return state.requirementsAnswers[state.requirementsIdx++] ?? "ok"
  }
  if (/^Which story or AC should I sharpen/i.test(prompt)) {
    return state.requirementsAnswers[state.requirementsIdx++] ?? "US-02 acceptance criteria"
  }
  throw new Error(`Unexpected workflow prompt: ${prompt}`)
}

function attachPromptAutoAnswers(
  bus: ReturnType<typeof createBus>,
  state: PromptingState,
  events: WorkflowEvent[],
): void {
  let promptCount = 0
  bus.subscribe(event => {
    events.push(event)
    if (event.type !== "prompt_requested") return

    promptCount += 1
    if (promptCount > 80) {
      throw new Error(`Unexpected prompt loop after ${promptCount} prompts; last prompt: ${event.prompt}`)
    }

    const answer = answerPrompt(event.prompt, state)
    bus.emit({ type: "prompt_answered", runId: event.runId, promptId: event.promptId, answer })
  })
}

function makePromptingIo(): { io: ReturnType<typeof busToWorkflowIO> & { bus: ReturnType<typeof createBus> }; events: WorkflowEvent[] } {
  const state: PromptingState = {
    brainstormAnswers: [
      "User needs structured workflow.",
      "Target audience: solo-operator teams.",
      "Constraint: single-node, no cloud access.",
      "Yes, constraints are stable enough.",
    ],
    requirementsAnswers: [
      "Focus: core workflow as input form.",
      "Status badges per entry.",
      "US-02 clearer: filter by status.",
    ],
    brainstormIdx: 0,
    requirementsIdx: 0,
  }

  const events: WorkflowEvent[] = []
  const bus = createBus()
  attachPromptAutoAnswers(bus, state, events)

  return { io: { ...busToWorkflowIO(bus), bus }, events }
}

function stageStarts(events: WorkflowEvent[]): string[] {
  return events
    .filter((event): event is Extract<WorkflowEvent, { type: "stage_started" }> => event.type === "stage_started")
    .map(event => event.stageKey)
}

for (const owner of ["cli", "api"] as const) {
  test(`${owner}-owned runs continue from planning into execution without operator action`, async () => {
    const dir = mkdtempSync(join(tmpdir(), `be2-${owner}-execution-autostart-`))
    const repoRoot = join(dir, "repo")
    const db = initDatabase(join(dir, "test.sqlite"))
    const repos = new Repos(db)
    try {
      seedCleanGitRepo(repoRoot)
      repos.upsertWorkspace({ key: "test", name: "Test", rootPath: repoRoot })
      const { io, events } = makePromptingIo()

      const prepared = prepareForegroundIdeaRun(repos, io, {
        title: `${owner}-owned auto progression`,
        description: "Planning should continue into execution automatically.",
        workspaceKey: "test",
        owner,
      })

      if (prepared.ok !== true) {
        assert.fail("expected prepareForegroundIdeaRun to succeed")
      }

      const startedAt = Date.now()
      await prepared.start()
      const elapsedMs = Date.now() - startedAt

      const run = repos.getRun(prepared.runId)
      assert.ok(run, "expected persisted run after foreground start")
      assert.equal(run?.owner, owner)
      assert.equal(run?.worker_owner_kind, owner)
      assert.equal(run?.status, "completed")
      assert.equal(run?.recovery_status, null)
      assert.ok(elapsedMs < 30_000, `expected planning-to-execution handoff within 30s, got ${elapsedMs} ms`)

      const startedStages = stageStarts(events)
      assert.ok(startedStages.includes("planning"))
      assert.ok(startedStages.includes("execution"))
      assert.ok(
        startedStages.indexOf("execution") > startedStages.indexOf("planning"),
        "execution must start after planning",
      )
      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(events.some(event => event.type === "run_resumed"), false)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test("execution launch failure after planning leaves a recoverable failed run with operator-facing guidance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-execution-launch-failure-"))
  const repoRoot = join(dir, "repo")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  try {
    seedCleanGitRepo(repoRoot)
    repos.upsertWorkspace({ key: "test", name: "Test", rootPath: repoRoot })
    const { io } = makePromptingIo()

    const prepared = prepareForegroundIdeaRun(repos, io, {
      title: "CLI-owned execution start failure",
      description: "Fail immediately after planning hands off to execution.",
      workspaceKey: "test",
      owner: "cli",
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) =>
        prepareRun(workflowItem, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async (_item, options) => {
            const runId = options.executionOwnership?.runId
            assert.ok(runId, "workflow runner must receive execution ownership context")
            if (runId == null) {
              throw new Error("workflow runner must receive execution ownership context")
            }
            workflowRepos.updateRun(runId, { status: "running", current_stage: "planning" })
            workflowRepos.updateRun(runId, { status: "running", current_stage: "execution" })
            markRunFailedRecoverable(workflowRepos, runId, "worker start failed: generic launch failure")
            throw new Error("worker start failed: generic launch failure")
          },
        }),
    })

    if (prepared.ok !== true) {
      assert.fail("expected prepareForegroundIdeaRun to succeed")
    }

    await prepared.start()

    const run = repos.getRun(prepared.runId)
    assert.ok(run, "expected persisted run after execution launch failure")
    if (run == null) {
      assert.fail("expected persisted run after execution launch failure")
    }
    assert.equal(run?.status, "failed")
    assert.equal(run?.recovery_status, "failed")
    assert.equal(run?.current_stage, "execution")
    assert.equal(recoveryUserMessageForRun(run), LOST_WORKER_USER_MESSAGE)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("execution handoff claimant ignores runs that already auto-progressed through execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-ignore-auto-progressed-run-"))
  const repoRoot = join(dir, "repo")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  try {
    seedCleanGitRepo(repoRoot)
    repos.upsertWorkspace({ key: "test", name: "Test", rootPath: repoRoot })
    const { io } = makePromptingIo()

    const prepared = prepareForegroundIdeaRun(repos, io, {
      title: "Completed CLI run",
      description: "Should not be reconsidered by the legacy execution handoff claimant.",
      workspaceKey: "test",
      owner: "cli",
    })
    if (prepared.ok !== true) {
      assert.fail("expected prepareForegroundIdeaRun to succeed")
    }
    await prepared.start()

    let resumeCalls = 0
    const claimResult = await claimExecutionOwnershipHandoffs(repos, {
      apiWorkerInstanceId: "api-worker-test",
      resumeRun: async () => {
        resumeCalls += 1
        return { ok: true }
      },
    })

    assert.deepEqual(claimResult.claimedRunIds, [])
    assert.equal(resumeCalls, 0)
    assert.equal(repos.getRun(prepared.runId)?.status, "completed")
    assert.equal(repos.getRun(prepared.runId)?.recovery_status, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

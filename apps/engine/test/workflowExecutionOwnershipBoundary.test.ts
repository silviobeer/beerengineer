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
import { prepareForegroundResumeRun } from "../src/core/runService.js"
import { loadResumeReadiness } from "../src/core/resume.js"
import { claimExecutionOwnershipHandoffs, EXECUTION_OWNERSHIP_HANDOFF_SUMMARY } from "../src/core/executionOwnershipHandoff.js"
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

test("API worker claims the blocked CLI handoff before execution resumes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-execution-handoff-"))
  const repoRoot = join(dir, "repo")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  try {
    seedCleanGitRepo(repoRoot)
    repos.upsertWorkspace({ key: "test", name: "Test", rootPath: repoRoot })

    const initial = makePromptingIo()
    const prepared = prepareForegroundIdeaRun(repos, initial.io, {
      title: "CLI-owned handoff",
      description: "Resume under API ownership",
      workspaceKey: "test",
      owner: "cli",
    })
    if (!prepared.ok) {
      assert.fail("expected prepareForegroundIdeaRun to succeed")
    }
    await prepared.start()

    const blockedRun = repos.getRun(prepared.runId)
    assert.equal(blockedRun?.owner, "cli")
    assert.equal(blockedRun?.worker_owner_kind, "cli")
    assert.equal(blockedRun?.status, "blocked")
    assert.equal(blockedRun?.recovery_scope_ref, "execution")

    const resumed = makePromptingIo()
    let ownerAtResumeStart: string | null = null
    const claimResult = await claimExecutionOwnershipHandoffs(repos, {
      apiWorkerInstanceId: "api-worker-test",
      resumeRun: async (claimRepos, input) => {
        ownerAtResumeStart = claimRepos.getRun(input.runId)?.owner ?? null
        assert.equal(input.summary, EXECUTION_OWNERSHIP_HANDOFF_SUMMARY)
        const preparedResume = await prepareForegroundResumeRun(claimRepos, resumed.io, {
          runId: input.runId,
          summary: input.summary,
          workerOwnerKind: "api",
          workerInstanceId: input.apiWorkerInstanceId,
        })
        if (!preparedResume.ok) {
          assert.fail("expected prepareForegroundResumeRun to succeed")
        }
        await preparedResume.start()
        return { ok: true }
      },
    })

    assert.deepEqual(claimResult.claimedRunIds, [prepared.runId])
    assert.equal(ownerAtResumeStart, "api")

    const initialStages = initial.events
      .filter((event): event is Extract<WorkflowEvent, { type: "stage_started" }> => event.type === "stage_started")
      .map(event => event.stageKey)
    assert.equal(initialStages.includes("execution"), false)

    const resumedStages = resumed.events
      .filter((event): event is Extract<WorkflowEvent, { type: "stage_started" }> => event.type === "stage_started")
      .map(event => event.stageKey)
    assert.equal(resumedStages.includes("execution"), true)

    const run = repos.getRun(prepared.runId)
    assert.equal(run?.owner, "api")
    assert.equal(run?.worker_owner_kind, "api")
    assert.notEqual(run?.recovery_status, "blocked")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("execution handoff claimant ignores blocked runs outside the CLI planning boundary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-ignore-execution-handoff-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Ignored", description: "" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, {
      status: "blocked",
      current_stage: "execution",
      recovery_status: "blocked",
      recovery_scope: "stage",
      recovery_scope_ref: "execution",
      recovery_summary: "Execution blocked for another reason.",
    })

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
    assert.equal(repos.getRun(run.id)?.owner, "api")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

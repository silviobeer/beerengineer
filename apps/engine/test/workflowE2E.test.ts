import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "../src/core/io.js"
import { runWorkflow } from "../src/workflow.ts"
import { layout } from "../src/core/workspaceLayout.js"
import { runWithActiveRun } from "../src/core/runContext.js"

/** Default answers for design-prep stages: 3 clarification no-ops + approve. */
const DEFAULT_VISUAL_COMPANION_ANSWERS = ["no existing mockups", "dashboard first", "WCAG AA required", "approve"]
const DEFAULT_FRONTEND_DESIGN_ANSWERS = ["no design system", "professional", "no brand constraints", "approve"]

function makeIO(answers: {
  brainstorm: string[]
  /** Clarification answers for visual-companion, followed by the user-review reply ("approve" / "revise: …").
   *  Defaults to 3 no-op clarification answers + "approve". */
  visualCompanion?: string[]
  /** Clarification answers for frontend-design, followed by the user-review reply ("approve" / "revise: …").
   *  Defaults to 3 no-op clarification answers + "approve". */
  frontendDesign?: string[]
  requirements: string[]
  qa: string
  handoff: string
}): { io: WorkflowIO; events: WorkflowEvent[]; promptLog: string[] } {
  const events: WorkflowEvent[] = []
  const promptLog: string[] = []
  const vcAnswers = answers.visualCompanion ?? DEFAULT_VISUAL_COMPANION_ANSWERS
  const fdAnswers = answers.frontendDesign ?? DEFAULT_FRONTEND_DESIGN_ANSWERS
  // The runtime prompt text is always "  you > "; use the preceding showMessage flow
  // via a counter-based mapping: brainstorm uses 4 asks, visual-companion uses
  // maxClarifications+1 asks (3 clarifications + 1 user-review), frontend-design likewise,
  // requirements uses 3 asks, qa 1, handoff 1.
  let brainstormIdx = 0
  let visualCompanionIdx = 0
  let frontendDesignIdx = 0
  let requirementsIdx = 0
  let phase: "brainstorm" | "visual-companion" | "frontend-design" | "requirements" | "qa" | "handoff" = "brainstorm"
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
        if (brainstormAsks >= answers.brainstorm.length) phase = "visual-companion"
        return answer
      }
      if (phase === "visual-companion") {
        const answer = vcAnswers[visualCompanionIdx++] ?? "approve"
        if (visualCompanionIdx >= vcAnswers.length) phase = "frontend-design"
        return answer
      }
      if (phase === "frontend-design") {
        const answer = fdAnswers[frontendDesignIdx++] ?? "approve"
        if (frontendDesignIdx >= fdAnswers.length) phase = "requirements"
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

/**
 * Initialise a clean real-git workspace at the given root: `git init`,
 * minimal commit, origin/HEAD pointer at main. Returns the root for
 * passing as `runWorkflow({...}, { workspaceRoot: root })`. Required now
 * that simulation has been removed and real-git is mandatory.
 */
function seedCleanGitRepo(root: string): void {
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: root, encoding: "utf8" })
}

test("runWorkflow runs end-to-end with all review/side loops, producing artifacts", async () => {
  await withTmpCwd(async () => {
    const originalLog = console.log
    console.log = () => {}
    seedCleanGitRepo(process.cwd())

    const { io, events } = makeIO({
      brainstorm: [
        "User needs structured workflow.",
        "Target audience: solo-operator teams.",
        "Constraint: single-node, no cloud access.",
        "Yes, constraints are stable enough.",
      ],
      // 3 clarification answers + 1 user-review approval
      visualCompanion: ["no existing mockups", "dashboard first", "WCAG AA required", "approve"],
      // 3 clarification answers + 1 user-review approval
      frontendDesign: ["no design system", "professional", "no brand constraints", "approve"],
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
        runWorkflow(
          { id: "i-1", title: "Test Workflow", description: "smoke" },
          { workspaceRoot: process.cwd() },
        ),
      )
    } finally {
      console.log = originalLog
    }

    // brainstorm produced concept + projects
    const ctx = { workspaceId: "test-workflow-i-1", workspaceRoot: process.cwd(), runId: "" }
    const wsDir = layout.workspaceDir(ctx)
    const wsJson = JSON.parse(await readFile(layout.workspaceFile(ctx), "utf8"))
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
    // Plans now lead with a kind:"setup" scaffold wave (Fix 4) so the
    // total count is 3: setup + two feature waves. The first feature
    // wave delivers a single story sequentially; the second is the
    // parallel-eligible expansion wave.
    assert.equal(plan.plan.waves.length, 3)
    assert.equal(plan.plan.waves[0].kind, "setup")
    assert.equal(plan.plan.waves[1].stories.length, 1)
    assert.equal(plan.plan.waves[2].internallyParallelizable, true)

    const qaReport = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "qa"), "qa-report.json"), "utf8"),
    )
    assert.equal(qaReport.accepted, true)

    const doc = JSON.parse(
      await readFile(join(layout.stageArtifactsDir(ctx, "documentation"), "documentation.json"), "utf8"),
    )
    assert.equal(doc.project.id, "P01")

    // wave summaries exist — every story must reach a terminal status.
    // Wave 1 is now the kind:"setup" scaffold wave (one task), wave 2
    // is the first feature wave (US-01 sequentially), wave 3 is the
    // expansion wave (US-02 + US-03 in parallel).
    const wave1 = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 1), "utf8"))
    const wave2 = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 2), "utf8"))
    const wave3 = JSON.parse(await readFile(layout.waveSummaryFile(ctx, 3), "utf8"))
    assert.equal(wave1.storiesBlocked.length, 0, "wave 1 (setup) must not block any task")
    assert.equal(wave1.waveBranch, "wave/test-workflow__p01__w1")
    assert.equal(wave1.projectBranch, "proj/test-workflow__p01")
    assert.equal(wave2.storiesMerged.length, 1, "wave 2 (sequential) should merge US-01")
    assert.equal(wave2.storiesBlocked.length, 0)
    assert.equal(wave3.storiesMerged.length, 2, "wave 3 should merge both stories")
    assert.equal(wave3.storiesBlocked.length, 0, "wave 3 must not silently block any story")

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
    const finalWs = JSON.parse(await readFile(layout.workspaceFile(ctx), "utf8"))
    assert.equal(finalWs.status, "approved", "last stage status propagated to workspace")
  })
})

test("runWorkflow writes documentation docs into the item worktree (item branch), not the operator's main workspace root", async () => {
  await withTmpCwd(async () => {
    const operatorCwd = process.cwd()
    const workspaceRoot = join(operatorCwd, "workspace")
    mkdirSync(workspaceRoot, { recursive: true })
    seedCleanGitRepo(workspaceRoot)

    const { io } = makeIO({
      brainstorm: ["Todo app", "Solo users", "Web only", "approve"],
      requirements: ["approve", "approve", "approve"],
      qa: "approve",
      handoff: "done",
    })

    await runWithWorkflowIO(io, async () => {
      await runWithActiveRun(
        {
          workspaceId: "docs-rooting-i-1",
          runId: "run-docs-rooting",
          itemSlug: "docs-rooting",
          workspaceRoot,
          owner: "cli",
          authoritative: false,
        },
        async () => {
          await runWorkflow(
            {
              id: "i-1",
              title: "Docs Rooting",
              workspaceId: "docs-rooting-i-1",
              description: "verify docs are rooted to the workspace",
            },
            { workspaceRoot },
          )
        },
      )
    })

    // Docs land under the item worktree (item branch) so the handoff stage's
    // merge of item → main brings them onto main as committed history. They
    // must NOT leak into the operator's main checkout (workspaceRoot/docs/)
    // or the launch-time cwd as untracked files.
    const itemWorktreeDocs = join(
      workspaceRoot,
      ".beerengineer",
      "worktrees",
      "docs-rooting-i-1",
      "items",
      "docs-rooting",
      "worktree",
      "docs",
    )
    assert.equal(existsSync(join(itemWorktreeDocs, "technical-doc.md")), true)
    assert.equal(existsSync(join(itemWorktreeDocs, "features-doc.md")), true)
    assert.equal(existsSync(join(itemWorktreeDocs, "README.compact.md")), true)
    assert.equal(existsSync(join(itemWorktreeDocs, "known-issues.md")), true)
    // Regression guards: never write docs into the operator's main checkout
    // or the launch-time cwd.
    assert.equal(existsSync(join(workspaceRoot, "docs", "technical-doc.md")), false)
    assert.equal(existsSync(join(workspaceRoot, "docs", "features-doc.md")), false)
    assert.equal(existsSync(join(workspaceRoot, "docs", "README.compact.md")), false)
    assert.equal(existsSync(join(workspaceRoot, "docs", "known-issues.md")), false)
    assert.equal(existsSync(join(operatorCwd, "docs", "technical-doc.md")), false)
    assert.equal(existsSync(join(operatorCwd, "docs", "features-doc.md")), false)
    assert.equal(existsSync(join(operatorCwd, "docs", "README.compact.md")), false)
    assert.equal(existsSync(join(operatorCwd, "docs", "known-issues.md")), false)
  })
})

test("runWorkflow blocks early when the workspace git repo is dirty", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-workflow-"))
  const events: WorkflowEvent[] = []
  try {
    spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
    writeFileSync(join(root, "README.md"), "seed\n")
    spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: root, encoding: "utf8" })
    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "dirty",
        name: "Dirty",
        harnessProfile: { mode: "claude-first" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "safe-workspace-write",
        },
        sonar: { enabled: false, baseBranch: "story/legacy-config-branch" },
        reviewPolicy: {
          coderabbit: { enabled: false },
          sonarcloud: { enabled: false, baseBranch: "story/legacy-config-branch" },
        },
        preflight: {
          git: { status: "ok" },
          github: { status: "ok", owner: "acme", repo: "demo", defaultBranch: "story/legacy-config-branch" },
          gh: { status: "missing" },
          sonar: { status: "missing" },
          coderabbit: { status: "missing" },
          checkedAt: new Date().toISOString(),
        },
        createdAt: Date.now(),
      }, null, 2),
    )
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n")

    const io: WorkflowIO = {
      async ask() {
        throw new Error("should not prompt while blocking on dirty repo")
      },
      emit(event) {
        events.push(event)
      },
    }

    await assert.rejects(
      () =>
        runWithWorkflowIO(io, () =>
          runWithActiveRun({ runId: "run-dirty", itemId: "item-dirty" }, () =>
            runWorkflow(
              { id: "item-dirty", title: "Dirty Repo Item", description: "should block" },
              { workspaceRoot: root },
            ),
          ),
        ),
      /Strategy violation: main\/master must stay clean/i,
    )

    const blocked = events.find((event) => event.type === "run_blocked")
    assert.ok(blocked, "expected run_blocked event")
    if (blocked?.type === "run_blocked") {
      assert.equal(blocked.scope.type, "run")
      assert.match(blocked.summary, /Strategy violation/i)
      assert.match(blocked.summary, /main\/master/i)
    }
    const baseBranchPresentation = events.find(
      (event) => event.type === "presentation" && /Base branch: main/.test(event.text),
    )
    assert.ok(baseBranchPresentation, "expected workflow to ignore stale story/* config branch and resolve main")
    assert.equal(events.some((event) => event.type === "run_finished"), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow blocks dirty engine-owned branches without labeling them as main/master violations", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-story-workflow-"))
  const events: WorkflowEvent[] = []
  try {
    spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
    writeFileSync(join(root, "README.md"), "seed\n")
    spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["checkout", "-b", "story/legacy-config-branch"], { cwd: root, encoding: "utf8" })
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n")

    const io: WorkflowIO = {
      async ask() {
        throw new Error("should not prompt while blocking on dirty repo")
      },
      emit(event) {
        events.push(event)
      },
    }

    await assert.rejects(
      () =>
        runWithWorkflowIO(io, () =>
          runWithActiveRun({ runId: "run-dirty-story", itemId: "item-dirty-story" }, () =>
            runWorkflow(
              { id: "item-dirty-story", title: "Dirty Story Repo Item", description: "should block" },
              { workspaceRoot: root },
            ),
          ),
        ),
      /BeerEngineer requires a clean repo before it creates an isolated item branch\./i,
    )

    const blocked = events.find((event) => event.type === "run_blocked")
    assert.ok(blocked, "expected run_blocked event")
    if (blocked?.type === "run_blocked") {
      assert.equal(blocked.scope.type, "run")
      assert.match(blocked.summary, /has uncommitted changes/i)
      assert.doesNotMatch(blocked.summary, /Strategy violation/i)
      assert.doesNotMatch(blocked.summary, /main\/master/i)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow blocks resume when design-prep freeze and brainstorm project ids drift", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    seedCleanGitRepo(repoRoot)
    const ctx = { workspaceId: "freeze-item-i-1", workspaceRoot: repoRoot, runId: "run-freeze" }
    const brainstormDir = layout.stageArtifactsDir(ctx, "brainstorm")
    const visualDir = layout.stageArtifactsDir(ctx, "visual-companion")
    mkdirSync(brainstormDir, { recursive: true })
    mkdirSync(visualDir, { recursive: true })
    writeFileSync(join(brainstormDir, "concept.json"), JSON.stringify({
      summary: "Freeze",
      problem: "Freeze",
      users: ["User"],
      constraints: ["Constraint"],
      hasUi: true,
    }))
    writeFileSync(join(brainstormDir, "projects.json"), JSON.stringify([
      {
        id: "P99",
        name: "Changed",
        description: "Changed project set",
        hasUi: true,
        concept: { summary: "Changed", problem: "Changed", users: ["User"], constraints: ["Constraint"] },
      },
    ]))
    writeFileSync(join(visualDir, "project-freeze.json"), JSON.stringify({ projectIds: ["P01"] }))

    const events: WorkflowEvent[] = []
    const io: WorkflowIO = {
      async ask() {
        throw new Error("should not prompt")
      },
      emit(event) {
        events.push(event)
      },
    }

    await assert.rejects(
      () =>
        runWithWorkflowIO(io, () =>
          runWithActiveRun({ runId: ctx.runId, itemId: "I-1", title: "Freeze Item" }, () =>
            runWorkflow(
              { id: "I-1", title: "Freeze Item", description: "freeze" },
              {
                workspaceRoot: repoRoot,
                resume: { scope: { type: "run", runId: ctx.runId }, currentStage: "projects" },
              },
            ),
          ),
        ),
      /project set changed after design prep/i,
    )

    assert.ok(events.some(event => event.type === "run_blocked"))
  })
})

test("runWorkflow skips interactive handoff in real git mode after merging project into item", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-realgit-handoff-"))
  const { io, promptLog } = makeIO({
    brainstorm: [
      "Browser greeting plus cli.",
      "Audience: developers.",
      "Constraint: local only.",
      "Stable enough.",
    ],
    requirements: [
      "Need browser.",
      "Need cli preserved.",
      "Need tests.",
    ],
    qa: "accept",
    handoff: "reject",
  })

  try {
    spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
    writeFileSync(join(root, "README.md"), "seed\n")
    spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })

    await runWithWorkflowIO(io, () =>
      runWorkflow(
        { id: "item-real-git", title: "Real Git Handoff", description: "should not prompt at handoff" },
        { workspaceRoot: root },
      ),
    )

    assert.equal(
      promptLog.some(prompt => prompt.startsWith("  Test, merge")),
      false,
      "real git mode must not prompt for candidate handoff decisions",
    )
    assert.equal(
      spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).stdout.trim(),
      "main",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

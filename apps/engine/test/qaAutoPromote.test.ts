import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus, busToWorkflowIO, type EventBus } from "../src/core/bus.js"
import { attachDbSync } from "../src/core/dbSync.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "../src/core/constants.js"
import { runWithWorkflowIO, type WorkflowEvent } from "../src/core/io.js"
import { withPromptPersistence } from "../src/core/promptPersistence.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { buildWorkspaceConfigFile, writeWorkspaceConfig } from "../src/core/workspaces/configFile.js"
import { runWorkflow } from "../src/workflow.ts"

function seedCleanGitRepo(root: string): void {
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["commit", "--allow-empty", "-m", "seed"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: root, encoding: "utf8" })
}

function answerWorkflowPrompt(input: {
  event: Extract<WorkflowEvent, { type: "prompt_requested" }>
  bus: EventBus
  qaAnswer: "fix" | "accept"
  mergeFallback?: string
  brainstormAnswers: string[]
  requirementsAnswers: string[]
  brainstormIndex: { current: number }
  requirementsIndex: { current: number }
}): void {
  const { event, bus, qaAnswer, mergeFallback, brainstormAnswers, requirementsAnswers, brainstormIndex, requirementsIndex } = input
  let answer: string | null = null

  if (event.prompt.startsWith("Promote ")) {
    if (mergeFallback !== undefined) {
      setTimeout(() => {
        bus.answer(event.promptId, mergeFallback)
      }, 0)
    }
    return
  }

  if (/wireframes or mockups/i.test(event.prompt)) answer = "none"
  else if (/screens or flows/i.test(event.prompt)) answer = "dashboard first"
  else if (/accessibility, responsive, or interaction constraints/i.test(event.prompt)) answer = "WCAG AA required"
  else if (/^Wireframe summary/i.test(event.prompt)) answer = "approve"
  else if (/design system, brand direction, or reference apps/i.test(event.prompt)) answer = "none"
  else if (/visual tone or product preference/i.test(event.prompt)) answer = "professional"
  else if (/hard constraints on color, typography, density, accessibility, or responsiveness/i.test(event.prompt)) answer = "no brand constraints"
  else if (/^Design summary/i.test(event.prompt)) answer = "approve"
  else if (/^Reviewer findings:/i.test(event.prompt)) answer = qaAnswer
  else if (/^What problem|^Who is|^What is the core value|^What constraints|^Why are/i.test(event.prompt)) {
    answer = brainstormAnswers[brainstormIndex.current++] ?? "ok"
  } else if (/^Which feature|^Which action|^Which important boundary/i.test(event.prompt)) {
    answer = requirementsAnswers[requirementsIndex.current++] ?? "ok"
  } else if (/^Which story or AC should I sharpen/i.test(event.prompt)) {
    answer = requirementsAnswers[requirementsIndex.current++] ?? "US-02 acceptance criteria"
  }

  if (answer === null) {
    throw new Error(`Unexpected workflow prompt: ${event.prompt}`)
  }
  bus.answer(event.promptId, answer)
}

async function withWorkflowFixture<T>(fn: (input: {
  root: string
  repos: Repos
  workspaceId: string
  itemId: string
  runId: string
}) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-qa-autopromote-"))
  const root = join(dir, "repo")
  const db = initDatabase(join(dir, "test.sqlite"))
  mkdirSync(root, { recursive: true })
  seedCleanGitRepo(root)
  try {
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: root })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Auto Promote", description: "smoke" })
    const run = repos.createRun({
      workspaceId: workspace.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `auto-promote-${item.id.toLowerCase()}`,
    })
    return await fn({
      root,
      repos,
      workspaceId: workspace.id,
      itemId: item.id,
      runId: run.id,
    })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

async function runAutopromoteWorkflow(input: {
  root: string
  repos: Repos
  workspaceId: string
  itemId: string
  runId: string
  autoPromoteOnGreenQa?: boolean
  qaAnswer: "fix" | "accept"
}): Promise<{ events: WorkflowEvent[] }> {
  await writeWorkspaceConfig(input.root, buildWorkspaceConfigFile({
    key: "demo",
    name: "Demo",
    harnessProfile: { mode: "fast" },
    sonar: { enabled: false },
    autoPromoteOnGreenQa: input.autoPromoteOnGreenQa,
  }))

  const bus = createBus()
  const io = busToWorkflowIO(bus)
  const events: WorkflowEvent[] = []
  const detachDbSync = attachDbSync(bus, input.repos, { runId: input.runId, itemId: input.itemId })
  const detachPromptPersistence = withPromptPersistence(bus, input.repos)
  const detachEvents = bus.subscribe(event => {
    events.push(event)
  })
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
  const brainstormIndex = { current: 0 }
  const requirementsIndex = { current: 0 }
  const detachAnswers = bus.subscribe(event => {
    if (event.type !== "prompt_requested") return
    answerWorkflowPrompt({
      event,
      bus,
      qaAnswer: input.qaAnswer,
      mergeFallback: NON_INTERACTIVE_NO_ANSWER_SENTINEL,
      brainstormAnswers,
      requirementsAnswers,
      brainstormIndex,
      requirementsIndex,
    })
  })

  try {
    await runWithWorkflowIO(io, () =>
      runWithActiveRun(
        {
          runId: input.runId,
          itemId: input.itemId,
          title: "Auto Promote",
          workspaceId: input.workspaceId,
          workspaceRoot: input.root,
          owner: "api",
        },
        () =>
          runWorkflow(
            { id: input.itemId, title: "Auto Promote", description: "smoke" },
            { workspaceRoot: input.root },
          ),
      ),
    )
  } catch (error) {
    if (!(error instanceof Error) || !/non-interactive/i.test(error.message)) {
      throw error
    }
  } finally {
    detachAnswers()
    detachEvents()
    detachPromptPersistence()
    detachDbSync()
    io.close?.()
  }

  return { events }
}

test("green QA auto-promotes through merge-gate by default when workspace policy is unset", async () => {
  await withWorkflowFixture(async fixture => {
    const { events } = await runAutopromoteWorkflow({
      ...fixture,
      qaAnswer: "fix",
    })

    const item = fixture.repos.getItem(fixture.itemId)
    assert.equal(item?.current_column, "done")
    assert.equal(item?.phase_status, "completed")
    assert.ok(events.some(event => event.type === "merge_gate_open"))
    assert.ok(events.some(event => event.type === "merge_completed"))
    assert.equal(events.some(event => event.type === "run_blocked"), false)
    assert.equal(fixture.repos.getOpenPrompt(fixture.runId), undefined)
  })
})

test("workspace autoPromoteOnGreenQa=false keeps later green QA runs waiting at merge, while another workspace still defaults on", async () => {
  await withWorkflowFixture(async fixture => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const scopedRepos = fixture.repos
      const workspace = scopedRepos.getWorkspace(fixture.workspaceId)!
      const item = scopedRepos.createItem({ workspaceId: workspace.id, title: `Disabled ${attempt}`, description: "smoke" })
      const run = scopedRepos.createRun({
        workspaceId: workspace.id,
        itemId: item.id,
        title: item.title,
        owner: "api",
        workspaceFsId: `disabled-${attempt}-${item.id.toLowerCase()}`,
      })

      const { events } = await runAutopromoteWorkflow({
        root: fixture.root,
        repos: scopedRepos,
        workspaceId: workspace.id,
        itemId: item.id,
        runId: run.id,
        autoPromoteOnGreenQa: false,
        qaAnswer: "fix",
      })

      assert.equal(scopedRepos.getItem(item.id)?.current_column, "merge")
      assert.equal(scopedRepos.getItem(item.id)?.phase_status, "review_required")
      assert.equal(scopedRepos.getRun(run.id)?.status, "blocked")
      assert.ok(events.some(event => event.type === "merge_gate_open"))
      assert.equal(events.some(event => event.type === "merge_completed"), false)
      assert.ok(scopedRepos.getOpenPrompt(run.id), "merge-gate prompt should remain open for manual promotion")
    }
  })

  await withWorkflowFixture(async fixture => {
    const { events } = await runAutopromoteWorkflow({
      ...fixture,
      qaAnswer: "fix",
    })
    assert.equal(fixture.repos.getItem(fixture.itemId)?.current_column, "done")
    assert.ok(events.some(event => event.type === "merge_completed"))
  })
})

test("auto-promotion does not fire for QA outcomes that still carry findings", async () => {
  await withWorkflowFixture(async fixture => {
    const { events } = await runAutopromoteWorkflow({
      ...fixture,
      qaAnswer: "accept",
    })

    const item = fixture.repos.getItem(fixture.itemId)
    const run = fixture.repos.getRun(fixture.runId)
    assert.equal(item?.current_column, "merge")
    assert.equal(item?.phase_status, "review_required")
    assert.equal(run?.status, "blocked")
    assert.ok(events.some(event => event.type === "merge_gate_open"))
    assert.equal(events.some(event => event.type === "merge_completed"), false)
    assert.ok(fixture.repos.getOpenPrompt(fixture.runId), "non-green QA should still require manual promotion")
  })
})

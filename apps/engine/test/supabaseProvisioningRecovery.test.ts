import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBus, busToWorkflowIO } from "../src/core/bus.js"
import { runWithWorkflowIO, type WorkflowEvent } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { attachDbSync } from "../src/core/dbSync.js"
import { execution } from "../src/stages/execution/index.js"
import { parseSupabaseProvisioningRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { handleGetRun } from "../src/api/routes/runs.js"
import { getBoard } from "../src/api/board.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import type { GitAdapter } from "../src/core/gitAdapter.js"
import type { SupabaseWorkflowHook } from "../src/core/supabase/workflowHook.js"
import type { WithPlan } from "../src/types/context.js"

function makeGit(): GitAdapter {
  return {
    enabled: true,
    mode: {
      enabled: true,
      kind: "workspace-root",
      workspaceRoot: "/tmp/workspace",
      baseBranch: "master",
      itemWorktreeRoot: "/tmp/workspace/.beerengineer/worktrees",
    },
    ensureItemBranch() {},
    ensureProjectBranch() {},
    mergeProjectIntoItem() {},
    mergeItemIntoBase() {
      return { mergeSha: "deadbeef" }
    },
    ensureWaveBranch() {
      return "wave"
    },
    ensureStoryBranch() {
      return "story"
    },
    ensureStoryWorktree() {
      return "/tmp/story"
    },
    mergeStoryIntoWave() {},
    mergeWaveIntoProject() {},
    rebaseStoryOntoWave() {
      return { ok: true }
    },
    abandonStoryBranch() {
      return null
    },
    removeStoryWorktree() {},
    exitRunToItemBranch() {
      return "item/demo-item"
    },
    assertWorkspaceRootOnBaseBranch() {},
    gcManagedStoryWorktrees() {
      return { removed: [], kept: [], errors: [] }
    },
  }
}

function captureRes() {
  const state: { status?: number; body?: string } = {}
  return {
    res: {
      writeHead(status: number) { state.status = status; return this },
      end(body: string) { state.body = body },
    } as never,
    state,
  }
}

function parseBody(state: ReturnType<typeof captureRes>["state"]): Record<string, unknown> {
  return state.body ? JSON.parse(state.body) as Record<string, unknown> : {}
}

function makePlanContext(root: string, workspaceId: string, runId: string): WithPlan {
  return {
    workspaceId,
    workspaceRoot: root,
    runId,
    itemSlug: "supabase-recovery",
    baseBranch: "master",
    project: {
      id: "PROJ-1",
      name: "Supabase Recovery",
      description: "Test project",
      concept: {
        summary: "summary",
        problem: "problem",
        users: ["operator"],
        constraints: ["keep same run"],
      },
    },
    prd: {
      stories: [
        {
          id: "REQ-1",
          title: "Recover blocked Supabase provisioning",
          acceptanceCriteria: [],
        },
      ],
    },
    architecture: {
      project: {
        id: "PROJ-1",
        name: "Supabase Recovery",
        description: "Test project",
      },
      concept: {
        summary: "summary",
        problem: "problem",
        users: ["operator"],
        constraints: ["keep same run"],
      },
      prdSummary: {
        storyCount: 1,
        storyIds: ["REQ-1"],
      },
      architecture: {
        summary: "summary",
        systemShape: "system",
        components: [{ name: "Supabase", responsibility: "provision branch" }],
        dataModelNotes: [],
        apiNotes: [],
        deploymentNotes: [],
        constraints: [],
        risks: [],
        openQuestions: [],
      },
    },
    plan: {
      project: {
        id: "PROJ-1",
        name: "Supabase Recovery",
      },
      conceptSummary: "summary",
      architectureSummary: "architecture",
      plan: {
        summary: "plan",
        assumptions: [],
        sequencingNotes: [],
        dependencies: [],
        risks: [],
        waves: [
          {
            id: "W1",
            number: 1,
            goal: "DB wave",
            kind: "feature",
            stories: [{ id: "REQ-1", title: "Recover blocked Supabase provisioning", dbRelevant: true }],
            dbRelevantStoryCount: 1,
            dbRelevantWave: true,
            internallyParallelizable: false,
            dependencies: [],
            exitCriteria: [],
          },
        ],
      },
    },
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-provisioning-recovery-"))
  mkdirSync(dir, { recursive: true })
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_alpha", region: "eu-central-1" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "DB item", description: "needs db" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api" })
  return {
    dir,
    db,
    repos,
    workspace,
    item,
    run,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function runExecutionFailure(input: {
  hook: SupabaseWorkflowHook
  ctx: WithPlan
  runId: string
  itemId: string
  title: string
}) {
  const bus = createBus()
  const io = busToWorkflowIO(bus)
  const events: WorkflowEvent[] = []
  const unsub = bus.subscribe(event => events.push(event))
  const detach = attachDbSync(bus, input.hook.repos, { runId: input.runId, itemId: input.itemId })
  try {
    await assert.rejects(
      runWithWorkflowIO(io, () =>
        runWithActiveRun({ runId: input.runId, itemId: input.itemId, title: input.title }, () =>
          execution(input.ctx, undefined, undefined, makeGit(), input.hook),
        ),
      ),
      /Wave W1 blocked stories: REQ-1/,
    )
  } finally {
    detach()
    unsub()
    bus.close()
  }
  return events
}

test("REQ-1 AC-1.1/AC-1.2/AC-1.3: initial Supabase provisioning failure blocks the same run and surfaces recovery guidance", async () => {
  const ctx = fixture()
  try {
    const planCtx = makePlanContext(ctx.dir, ctx.workspace.id, ctx.run.id)
    const events = await runExecutionFailure({
      ctx: planCtx,
      runId: ctx.run.id,
      itemId: ctx.item.id,
      title: ctx.item.title,
      hook: {
        repos: ctx.repos,
        workspaceId: ctx.workspace.id,
        projectRef: "proj_alpha",
        dbMode: "branching",
        parentBranchRef: "branch_parent",
        protectionSwitch: "off",
        cleanupPolicy: "manual",
        adapter: {
          provisionBranch: async () => ({ ok: false, context: { message: "Management API rejected branch creation" } }),
          pollBranchStatus: async () => ({ ok: true }),
          validateBranch: async () => ({ ok: true }),
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
      },
    })

    const run = ctx.repos.getRun(ctx.run.id)
    assert.ok(run)
    assert.equal(run?.id, ctx.run.id)
    assert.equal(run?.status, "blocked")
    assert.equal(run?.recovery_status, "blocked")
    assert.equal(run?.recovery_scope, "run")
    assert.match(run?.recovery_summary ?? "", /Supabase provisioning failed/i)
    assert.equal(ctx.repos.listRuns().length, 1)

    const payload = parseSupabaseProvisioningRecoveryPayload(run?.recovery_payload_json)
    assert.equal(payload?.runId, ctx.run.id)
    assert.equal(payload?.failedStep, "provision")
    assert.equal(payload?.failureCause, "Management API rejected branch creation")

    const blocked = events.find(event => event.type === "run_blocked")
    assert.ok(blocked)
    assert.equal(events.some(event => event.type === "run_finished"), false)

    const { res, state } = captureRes()
    handleGetRun(ctx.repos, res, ctx.run.id)
    assert.equal(state.status, 200)
    const body = parseBody(state)
    assert.equal(body.id, ctx.run.id)
    assert.equal(body.recovery_user_message, "Supabase provisioning failed. Operator recovery action is required.")
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.1: later provisioning-step failure still blocks the original run and board projection keeps that run authoritative", async () => {
  const ctx = fixture()
  try {
    const planCtx = makePlanContext(ctx.dir, ctx.workspace.id, ctx.run.id)
    const events = await runExecutionFailure({
      ctx: planCtx,
      runId: ctx.run.id,
      itemId: ctx.item.id,
      title: ctx.item.title,
      hook: {
        repos: ctx.repos,
        workspaceId: ctx.workspace.id,
        projectRef: "proj_alpha",
        dbMode: "branching",
        parentBranchRef: "branch_parent",
        protectionSwitch: "off",
        cleanupPolicy: "manual",
        adapter: {
          provisionBranch: async () => {
            ctx.repos.setRunSupabaseBranch(ctx.run.id, { ref: "branch_wave", name: "branch-wave", lifecycleState: "provisioning" })
            return { ok: true, context: { branchRef: "branch_wave", branchName: "branch-wave" } }
          },
          pollBranchStatus: async () => ({ ok: true, context: { status: "ready" } }),
          validateBranch: async () => ({ ok: false, context: { message: "Migration smoke test failed" } }),
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
      },
    })

    const run = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(run?.recovery_payload_json)
    assert.equal(run?.status, "blocked")
    assert.equal(run?.recovery_scope, "run")
    assert.equal(run?.supabase_branch_ref, "branch_wave")
    assert.equal(payload?.failedStep, "validate")
    assert.equal(payload?.failureCause, "Migration smoke test failed")
    assert.equal(ctx.repos.listRuns().length, 1)

    const board = getBoard(ctx.db, "alpha")
    const card = board.columns.flatMap(column => column.cards).find(candidate => candidate.itemId === ctx.item.id)
    assert.equal(card?.latestRunId, ctx.run.id)
    assert.equal(card?.hasBlockedRun, true)
    assert.equal(card?.recovery_user_message, "Supabase provisioning failed. Operator recovery action is required.")
    assert.ok(events.some(event => event.type === "run_blocked"))
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.4: unexpected provisioning exceptions still produce the blocked same-run recovery contract", async () => {
  const ctx = fixture()
  try {
    const planCtx = makePlanContext(ctx.dir, ctx.workspace.id, ctx.run.id)
    await runExecutionFailure({
      ctx: planCtx,
      runId: ctx.run.id,
      itemId: ctx.item.id,
      title: ctx.item.title,
      hook: {
        repos: ctx.repos,
        workspaceId: ctx.workspace.id,
        projectRef: "proj_alpha",
        dbMode: "branching",
        parentBranchRef: "branch_parent",
        protectionSwitch: "off",
        cleanupPolicy: "manual",
        adapter: {
          provisionBranch: async () => ({ ok: true, context: { branchRef: "branch_wave", branchName: "branch-wave" } }),
          pollBranchStatus: async () => {
            throw new Error("Socket hung up during branch polling")
          },
          validateBranch: async () => ({ ok: true }),
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
      },
    })

    const run = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(run?.recovery_payload_json)
    assert.equal(run?.status, "blocked")
    assert.equal(run?.recovery_scope, "run")
    assert.equal(payload?.runId, ctx.run.id)
    assert.equal(payload?.failedStep, "poll")
    assert.equal(payload?.failureCause, "Socket hung up during branch polling")
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.3: missing provider detail still yields a non-empty human-readable failure cause", async () => {
  const ctx = fixture()
  try {
    const planCtx = makePlanContext(ctx.dir, ctx.workspace.id, ctx.run.id)
    await runExecutionFailure({
      ctx: planCtx,
      runId: ctx.run.id,
      itemId: ctx.item.id,
      title: ctx.item.title,
      hook: {
        repos: ctx.repos,
        workspaceId: ctx.workspace.id,
        projectRef: "proj_alpha",
        dbMode: "branching",
        parentBranchRef: "branch_parent",
        protectionSwitch: "off",
        cleanupPolicy: "manual",
        adapter: {
          provisionBranch: async () => ({ ok: false }),
          pollBranchStatus: async () => ({ ok: true }),
          validateBranch: async () => ({ ok: true }),
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
      },
    })

    const payload = parseSupabaseProvisioningRecoveryPayload(ctx.repos.getRun(ctx.run.id)?.recovery_payload_json)
    assert.ok(payload)
    assert.match(payload.failureCause, /Supabase branch provisioning failed/i)
    assert.ok(payload.failureCause.trim().length > 0)
  } finally {
    ctx.close()
  }
})

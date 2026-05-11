import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { buildSupabaseProvisioningRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { layout } from "../src/core/workspaceLayout.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { removeTempDir } from "./helpers/fs.js"

function seedCliRepo(repoRoot: string): void {
  mkdirSync(repoRoot, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" })
  writeFileSync(join(repoRoot, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: repoRoot, encoding: "utf8" })
}

function seedReplanArtifacts(repoRoot: string, workspaceFsId: string, runId: string): void {
  const ctx = { workspaceId: workspaceFsId, workspaceRoot: repoRoot, runId }
  const planningDir = layout.stageArtifactsDir(ctx, "planning")
  const brainstormDir = layout.stageArtifactsDir(ctx, "brainstorm")
  const requirementsDir = layout.stageArtifactsDir(ctx, "requirements")
  const architectureDir = layout.stageArtifactsDir(ctx, "architecture")
  mkdirSync(planningDir, { recursive: true })
  mkdirSync(brainstormDir, { recursive: true })
  mkdirSync(requirementsDir, { recursive: true })
  mkdirSync(architectureDir, { recursive: true })

  writeFileSync(join(planningDir, "implementation-plan.json"), `${JSON.stringify({
    project: { id: "proj-1", name: "Project One" },
    conceptSummary: "Stable replan concept",
    architectureSummary: "Run control owns plan replacement.",
    plan: {
      summary: "Original plan",
      assumptions: ["Upstream context remains approved."],
      sequencingNotes: ["Replans replace the active plan only after preparation succeeds."],
      dependencies: ["requirements", "architecture"],
      risks: ["Replacement plan may reorder work."],
      waves: [
        {
          id: "W1",
          number: 1,
          goal: "Original wave one",
          kind: "feature",
          stories: [{ id: "REQ-1", title: "REQ-1 title", dbRelevant: false, sharedFiles: ["apps/engine/REQ-1.ts"] }],
          dbRelevantStoryCount: 0,
          dbRelevantWave: false,
          internallyParallelizable: false,
          dependencies: [],
          exitCriteria: ["Wave 1 complete."],
        },
        {
          id: "W2",
          number: 2,
          goal: "Original wave two",
          kind: "feature",
          stories: [{ id: "REQ-2", title: "REQ-2 title", dbRelevant: false, sharedFiles: ["apps/engine/REQ-2.ts"] }],
          dbRelevantStoryCount: 0,
          dbRelevantWave: false,
          internallyParallelizable: false,
          dependencies: ["W1"],
          exitCriteria: ["Wave 2 complete."],
        },
      ],
    },
  }, null, 2)}\n`)
  writeFileSync(join(planningDir, "implementation-plan.md"), "# Project One\n\nOriginal plan\n")
  writeFileSync(join(brainstormDir, "projects.json"), `${JSON.stringify([{
    id: "proj-1",
    name: "Project One",
    description: "Project for replan testing",
    concept: {
      summary: "Operator-visible replan",
      problem: "Plans need safe replacement",
      users: ["operators"],
      constraints: ["single run row"],
    },
  }], null, 2)}\n`)
  writeFileSync(join(requirementsDir, "prd.json"), `${JSON.stringify({
    prd: {
      stories: [
        { id: "REQ-1", title: "First story", acceptanceCriteria: [{ id: "AC-1", text: "Do the first thing", priority: "must", category: "functional" }] },
        { id: "REQ-2", title: "Second story", acceptanceCriteria: [{ id: "AC-2", text: "Do the second thing", priority: "must", category: "functional" }] },
      ],
    },
  }, null, 2)}\n`)
  writeFileSync(join(architectureDir, "architecture.json"), `${JSON.stringify({
    project: { id: "proj-1", name: "Project One", description: "Project for replan testing" },
    concept: {
      summary: "Operator-visible replan",
      problem: "Plans need safe replacement",
      users: ["operators"],
      constraints: ["single run row"],
    },
    prdSummary: { storyCount: 2, storyIds: ["REQ-1", "REQ-2"] },
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
  }, null, 2)}\n`)
}

function seedCliReplanFixture(input: {
  dir: string
  repoRoot: string
  status?: "blocked" | "running"
  heartbeatAt?: number
}): { dbPath: string; runId: string; workspaceFsId: string } {
  const dbPath = join(input.dir, "workflow.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: input.repoRoot })
  const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Replan", description: "swap plans safely" })
  const run = repos.createRun({
    workspaceId: ws.id,
    itemId: item.id,
    title: item.title,
    owner: "cli",
    status: input.status ?? "blocked",
    workspaceFsId: `cli-replan-${item.id.toLowerCase()}`,
  })
  repos.updateRun(run.id, {
    status: input.status ?? "blocked",
    current_stage: "planning",
    recovery_status: input.status === "running" ? null : "blocked",
    recovery_scope: input.status === "running" ? null : "run",
    recovery_scope_ref: null,
    recovery_summary: input.status === "running" ? null : "Operator paused for replanning.",
    recovery_payload_json: null,
  })
  if (input.heartbeatAt != null) {
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-replan-worker",
      workerOwnerKind: "cli",
      now: input.heartbeatAt,
    })
  }
  db.close()

  seedReplanArtifacts(input.repoRoot, run.workspace_fs_id!, run.id)
  return { dbPath, runId: run.id, workspaceFsId: run.workspace_fs_id! }
}

test("beerengineer item action start_brainstorm continues through execution from the terminal CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        // Fake brainstorm + visual-companion + frontend-design + requirements etc.
        // each ask follow-up prompts; feed enough generic answers to carry the
        // whole flow to completion. Extras are harmless once stdin is closed.
        // (Previously relied on silent empty-answer on stdin EOF; that behaviour
        // was removed intentionally — see stageRuntime.ts:398.)
        input:
          "Title from terminal\nDescription from terminal\naccept\n" +
          "local-only smoke test\n" +
          "none\ndashboard first\nWCAG AA required\napprove\n" +
          "none\nprofessional\nno brand constraints\napprove\n" +
          "ok\nok\nok\naccept\npromote\n",
        timeout: 15000,
      }
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /start_brainstorm applied/)
    assert.match(result.stdout ?? "", /run-id:/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns()
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.owner, "cli")
    assert.equal(runs[0]?.worker_owner_kind, "cli")
    assert.ok(runs[0]?.worker_instance_id, "CLI command must persist a worker instance id")
    assert.equal(typeof runs[0]?.worker_started_at, "number")
    assert.equal(typeof runs[0]?.worker_heartbeat_at, "number")
    assert.equal(runs[0]?.status, "completed")
    assert.equal(runs[0]?.recovery_status, null)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

test("beerengineer item action start_brainstorm prints git identity repair steps before starting", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-git-gate-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "global.gitconfig") }
  mkdirSync(repoRoot, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8", env: gitEnv })

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BEERENGINEER_UI_DB_PATH: dbPath,
          BEERENGINEER_CONFIG_PATH: join(dir, "missing-config.json"),
          BEERENGINEER_ALLOWED_ROOTS: dir,
          GIT_CONFIG_GLOBAL: join(dir, "global.gitconfig"),
        },
        timeout: 5000,
      },
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Workflow start blocked by Git readiness/)
    assert.match(result.stderr ?? "", /Git identity/i)
    assert.match(result.stderr ?? "", /beerengineer setup/)
    assert.match(result.stderr ?? "", /Retry: beerengineer item action --item ITEM-0001 --action start_brainstorm/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    assert.equal(verifyRepos.listRuns().length, 0)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

test("beerengineer item action start_implementation resumes from brainstorm artifacts and continues through execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)
  let workspaceIdForCleanup: string | null = null

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    const item = repos.createItem({
      workspaceId: ws.id,
      code: "ITEM-0001",
      title: "CLI Implementation",
      description: "resume from brainstorm",
    })
    repos.setItemColumn(item.id, "requirements", "draft")
    const seedRun = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId: `cli-implementation-${item.id.toLowerCase()}`,
    })
    db.close()

    const workspaceId = `cli-implementation-${item.id.toLowerCase()}`
    workspaceIdForCleanup = workspaceId
    const previousCwd = process.cwd()
    try {
      process.chdir(engineRoot)
      const brainstormDir = layout.stageArtifactsDir({ workspaceId, workspaceRoot: repoRoot, runId: seedRun.id }, "brainstorm")
      removeTempDir(layout.workspaceDir({ workspaceId, workspaceRoot: repoRoot }))
      mkdirSync(brainstormDir, { recursive: true })
      writeFileSync(
        join(brainstormDir, "projects.json"),
        JSON.stringify(
          [
            {
              id: item.id,
              name: "Browser greeting page",
              description: "Add a browser-rendered greeting alongside the CLI.",
              concept: {
                summary: "Browser greeting page for the hello-world-cli repo.",
                problem: "The repo only exposes Hello, World! via CLI today.",
                users: ["Developers who want a browser UI in addition to the CLI"],
                constraints: ["React 18", "TypeScript strict", "Vitest", "Do not break bin/hello.js"],
              },
            },
          ],
          null,
          2,
        ),
      )
    } finally {
      process.chdir(previousCwd)
    }

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_implementation"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        input: [
          "Focus on a single static greeting page.",
          "Keep CLI and browser entry points separate.",
          "accept",
          "accept",
          ...Array.from({ length: 16 }, () => "promote"),
        ].join("\n") + "\n",
        timeout: 20000,
      },
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /start_implementation applied/)
    assert.match(result.stdout ?? "", /run-id:/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns().filter(run => run.item_id === item.id)
    const latest = runs.sort((a, b) => b.created_at - a.created_at)[0]
    assert.equal(latest?.owner, "cli")
    assert.equal(latest?.status, "completed")
    assert.equal(latest?.recovery_status, null)
    verifyDb.close()
  } finally {
    const previousCwd = process.cwd()
    try {
      process.chdir(engineRoot)
      if (workspaceIdForCleanup) removeTempDir(layout.workspaceDir({ workspaceId: workspaceIdForCleanup, workspaceRoot: repoRoot }))
    } finally {
      process.chdir(previousCwd)
    }
    removeTempDir(dir)
  }
})

test("beerengineer item action resume_run exits 75 without remediation summary in non-interactive mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")

  try {
    const dbPath = join(dir, "resume.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Blocked CLI Workflow", description: "smoke" })
    repos.setItemColumn(item.id, "implementation", "failed")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.setRunRecovery(run.id, { status: "blocked", scope: "run", scopeRef: null, summary: "fix needed" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "resume_run"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
      }
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Missing --remediation-summary/)
    assert.match(result.stderr ?? "", /Run .* is blocked\./)
  } finally {
    removeTempDir(dir)
  }
})

test("beerengineer item action resume_run rejects Supabase provisioning recovery and points operators to run resume", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-supabase-blocked-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const recoveryMessage = [
      "Supabase provisioning failed.",
      "Create or verify the branch manually.",
      "Then resume this run after confirming the fix.",
    ].join("\n")
    const { dbPath, blockedRunId } = await seedResumableSupabaseProvisioningRunFixture({
      dir,
      repoRoot,
      userMessage: recoveryMessage,
    })

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "resume_run"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BEERENGINEER_UI_DB_PATH: dbPath,
          BEERENGINEER_ALLOWED_ROOTS: dir,
        },
      },
    )

    assert.notEqual(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.equal((result.stderr ?? "").indexOf("Supabase provisioning failed."), 0)
    assert.match(result.stderr ?? "", /Create or verify the branch manually\./)
    assert.match(result.stderr ?? "", /Then resume this run after confirming the fix\./)
    assert.match(result.stderr ?? "", new RegExp(`beerengineer run resume ${blockedRunId} --remediation-summary`))
    assert.doesNotMatch(result.stderr ?? "", /Missing --remediation-summary/)
    assert.doesNotMatch(result.stdout ?? "", /resume_run applied/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns()
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.id, blockedRunId)
    assert.equal(runs[0]?.status, "blocked")
    assert.equal(runs[0]?.recovery_status, "blocked")
    assert.equal(verifyRepos.listExternalRemediations(blockedRunId).length, 0)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

test("beerengineer item action start_brainstorm fails early on dirty workspace repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-dirty-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "workspace")

  try {
    mkdirSync(repoRoot, { recursive: true })
    assert.equal(spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    writeFileSync(join(repoRoot, "README.md"), "seed\n")
    assert.equal(spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    writeFileSync(join(repoRoot, "dirty.txt"), "uncommitted\n")

    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
      }
    )

    assert.equal(result.status, 73, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Git preflight failed: workspace repo is dirty\./)
    assert.match(result.stderr ?? "", /Strategy violation: uncommitted work is sitting on main\/master\./)
    assert.match(result.stderr ?? "", /main\/master to stay clean; item work must happen on item\/\* branches\./)
    assert.match(result.stderr ?? "", /git status/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    assert.equal(verifyRepos.listRuns().length, 0)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

async function seedResumableSupabaseProvisioningRunFixture(input: {
  dir: string
  repoRoot: string
  userMessage: string
  extraRun?: "completed_nonrecoverable" | "completed_with_alternate_recoverable"
}): Promise<{ dbPath: string; blockedRunId: string; wrongRunId?: string }> {
  const dbPath = join(input.dir, "workflow.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: input.repoRoot })
  const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "DB Workflow", description: "needs db" })
  repos.setItemColumn(item.id, "implementation", "failed")
  const blockedRun = repos.createRun({
    workspaceId: ws.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: `cli-recovery-${item.id.toLowerCase()}`,
  })
  const ctx = { workspaceId: blockedRun.workspace_fs_id!, workspaceRoot: input.repoRoot, runId: blockedRun.id }
  const brainstormDir = layout.stageArtifactsDir(ctx, "brainstorm")
  const requirementsDir = layout.stageArtifactsDir(ctx, "requirements")
  const architectureDir = layout.stageArtifactsDir(ctx, "architecture")
  const planningDir = layout.stageArtifactsDir(ctx, "planning")
  mkdirSync(brainstormDir, { recursive: true })
  mkdirSync(requirementsDir, { recursive: true })
  mkdirSync(architectureDir, { recursive: true })
  mkdirSync(planningDir, { recursive: true })
  writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: blockedRun.id }, null, 2)}\n`)
  writeFileSync(join(brainstormDir, "projects.json"), JSON.stringify([{ id: "PROJ", name: "DB Project", description: "schema", hasUi: false, concept: { summary: "db", problem: "db", users: ["ops"], constraints: [] } }], null, 2))
  writeFileSync(join(requirementsDir, "prd.json"), JSON.stringify({
    prd: {
      id: "PRD",
      title: "DB",
      stories: [{ id: "US-1", title: "copy", acceptanceCriteria: [] }],
    },
  }, null, 2))
  writeFileSync(join(architectureDir, "architecture.json"), JSON.stringify({ project: { id: "PROJ", name: "DB Project", description: "schema" }, architecture: { summary: "db" } }, null, 2))
  writeFileSync(join(planningDir, "implementation-plan.json"), JSON.stringify({
    project: { id: "PROJ", name: "DB Project" },
    conceptSummary: "db",
    architectureSummary: "db",
    plan: {
      summary: "db",
      assumptions: [],
      sequencingNotes: [],
      dependencies: [],
      risks: [],
      waves: [
        {
          id: "W1",
          number: 1,
          goal: "copy",
          kind: "feature",
          stories: [{ id: "US-1", title: "copy", dbRelevant: false }],
          dbRelevantStoryCount: 0,
          dbRelevantWave: false,
          internallyParallelizable: false,
          dependencies: [],
          exitCriteria: [],
        },
      ],
    },
  }, null, 2))
  await writeRecoveryRecord(ctx, {
    status: "blocked",
    cause: "stage_error",
    scope: { type: "stage", runId: blockedRun.id, stageId: "execution" },
    summary: "Supabase provisioning failed during branch validation: original failure",
    evidencePaths: [planningDir],
  })
  repos.updateRun(blockedRun.id, { status: "blocked", current_stage: "execution" })
  repos.setRunRecovery(blockedRun.id, {
    status: "blocked",
    scope: "stage",
    scopeRef: "execution",
    summary: "Supabase provisioning failed during branch validation: original failure",
    payloadJson: buildSupabaseProvisioningRecoveryPayload({
      runId: blockedRun.id,
      workspaceId: ws.id,
      workspaceKey: ws.key,
      projectRef: "proj_alpha",
      waveId: "W1",
      waveNumber: 1,
      branchRef: "br_saved",
      failedStep: "validate",
      failureCause: "Migration smoke test failed",
      userMessage: input.userMessage,
    }),
  })

  let wrongRunId: string | undefined
  if (input.extraRun) {
    const wrongRun = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: `${item.title} wrong target`,
      owner: "cli",
      workspaceFsId: `cli-recovery-wrong-${item.id.toLowerCase()}`,
    })
    repos.updateRun(wrongRun.id, { status: "completed", current_stage: "handoff" })
    wrongRunId = wrongRun.id
    if (input.extraRun === "completed_nonrecoverable") {
      repos.updateRun(blockedRun.id, { status: "completed", current_stage: "handoff" })
      repos.clearRunRecovery(blockedRun.id)
    }
  }

  db.close()
  if (input.extraRun === "completed_nonrecoverable") {
    return { dbPath, blockedRunId: wrongRunId! }
  }
  return { dbPath, blockedRunId: blockedRun.id, wrongRunId }
}

test("REQ-3 CLI run resume proceeds against the blocked run with a zero exit code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-resume-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const recoveryMessage = [
      "Supabase provisioning failed.",
      "Create or verify the branch manually.",
      "Then resume this run after confirming the fix.",
    ].join("\n")
    const { dbPath, blockedRunId } = await seedResumableSupabaseProvisioningRunFixture({
      dir,
      repoRoot,
      userMessage: recoveryMessage,
    })

    const resume = spawnSync(
      process.execPath,
      [binPath, "run", "resume", blockedRunId, "--remediation-summary", "validated manual provider fix"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        timeout: 10000,
      },
    )

    assert.equal(resume.status, 0, `${resume.stdout ?? ""}\n${resume.stderr ?? ""}`)
    assert.match(resume.stdout ?? "", /run resume applied/)
    assert.match(resume.stdout ?? "", new RegExp(`run-id: ${blockedRunId}`))

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    assert.equal(verifyRepos.listExternalRemediations(blockedRunId).length, 1)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

test("REQ-3 CLI run resume rejects the wrong run target and names the correct blocked run command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-resume-wrong-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const { dbPath, blockedRunId, wrongRunId } = await seedResumableSupabaseProvisioningRunFixture({
      dir,
      repoRoot,
      userMessage: "Supabase provisioning failed.\nResume this exact run after the fix.",
      extraRun: "completed_with_alternate_recoverable",
    })

    const result = spawnSync(
      process.execPath,
      [binPath, "run", "resume", wrongRunId!, "--remediation-summary", "wrong target"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
      },
    )

    assert.notEqual(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", new RegExp(`Run ${wrongRunId} is not recoverable`))
    assert.match(result.stderr ?? "", new RegExp(`beerengineer run resume ${blockedRunId} --remediation-summary`))
  } finally {
    removeTempDir(dir)
  }
})

test("REQ-3 CLI run resume rejects a non-recoverable run with explicit state-specific failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-resume-not-recoverable-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const { dbPath, blockedRunId } = await seedResumableSupabaseProvisioningRunFixture({
      dir,
      repoRoot,
      userMessage: "Supabase provisioning failed.\nResume this exact run after the fix.",
      extraRun: "completed_nonrecoverable",
    })

    const result = spawnSync(
      process.execPath,
      [binPath, "run", "resume", blockedRunId, "--remediation-summary", "nothing to fix"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
      },
    )

    assert.notEqual(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", new RegExp(`Run ${blockedRunId} is not recoverable`))
    assert.doesNotMatch(result.stderr ?? "", /Unknown command|Invalid transition/)
    assert.doesNotMatch(result.stderr ?? "", /beerengineer run resume .* --remediation-summary/)
  } finally {
    removeTempDir(dir)
  }
})

test("REQ-2 CLI run replan succeeds through the dedicated operator action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-replan-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const { dbPath, runId, workspaceFsId } = seedCliReplanFixture({ dir, repoRoot })

    const result = spawnSync(
      process.execPath,
      [binPath, "run", "replan", runId, "--reason", "Operator requested a new plan split"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        timeout: 10000,
      },
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /run replan applied/)
    assert.match(result.stdout ?? "", new RegExp(`run-id: ${runId}`))

    const planPath = join(layout.stageArtifactsDir({ workspaceId: workspaceFsId, workspaceRoot: repoRoot, runId }, "planning"), "implementation-plan.json")
    const after = JSON.parse(readFileSync(planPath, "utf8")) as { metadata: { activePlan: { version: number } } }
    assert.equal(after.metadata.activePlan.version, 2)
  } finally {
    removeTempDir(dir)
  }
})

test("REQ-2 CLI run replan rejects missing or blank reason with a clear error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-replan-missing-reason-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const { dbPath, runId } = seedCliReplanFixture({ dir, repoRoot })

    for (const args of [
      [binPath, "run", "replan", runId],
      [binPath, "run", "replan", runId, "--reason", "   "],
    ]) {
      const result = spawnSync(
        process.execPath,
        args,
        {
          cwd: engineRoot,
          encoding: "utf8",
          env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        },
      )

      assert.notEqual(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
      assert.match(result.stderr ?? "", /Missing --reason \(required for run replan\)\./)
    }
  } finally {
    removeTempDir(dir)
  }
})

test("REQ-2 CLI run replan surfaces active-run conflict guidance without changing the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-run-replan-active-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const { dbPath, runId, workspaceFsId } = seedCliReplanFixture({
      dir,
      repoRoot,
      status: "running",
      heartbeatAt: Date.now(),
    })
    const planPath = join(layout.stageArtifactsDir({ workspaceId: workspaceFsId, workspaceRoot: repoRoot, runId }, "planning"), "implementation-plan.json")
    const before = readFileSync(planPath, "utf8")

    const result = spawnSync(
      process.execPath,
      [binPath, "run", "replan", runId, "--reason", "Need a fresh plan right now"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
      },
    )

    assert.notEqual(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Run is still actively executing and cannot be replanned\./)
    assert.match(result.stderr ?? "", /Use POST \/runs\/:runId\/block-now to pause, then replan\./)
    assert.equal(readFileSync(planPath, "utf8"), before)
  } finally {
    removeTempDir(dir)
  }
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { layout } from "../src/core/workspaceLayout.js"
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

test("beerengineer item action start_brainstorm runs to completion through the terminal CLI", () => {
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
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
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
    assert.equal(runs[0]?.status, "completed")
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

test("beerengineer item action start_implementation resumes from brainstorm artifacts as a cli-owned run", () => {
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
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
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
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
      }
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Missing --remediation-summary/)
    assert.match(result.stderr ?? "", /Run .* is blocked\./)
  } finally {
    removeTempDir(dir)
  }
})

test("beerengineer item action resume_run reports Supabase readiness actions without creating a new run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-supabase-blocked-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "DB Workflow", description: "needs db" })
    repos.setItemColumn(item.id, "implementation", "failed")
    const workspaceFsId = `db-workflow-${item.id.toLowerCase()}`
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId,
    })
    const ctx = { workspaceId: workspaceFsId, workspaceRoot: repoRoot, runId: run.id }
    const brainstormDir = layout.stageArtifactsDir(ctx, "brainstorm")
    const requirementsDir = layout.stageArtifactsDir(ctx, "requirements")
    const architectureDir = layout.stageArtifactsDir(ctx, "architecture")
    const planningDir = layout.stageArtifactsDir(ctx, "planning")
    mkdirSync(brainstormDir, { recursive: true })
    mkdirSync(requirementsDir, { recursive: true })
    mkdirSync(architectureDir, { recursive: true })
    mkdirSync(planningDir, { recursive: true })
    writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
    writeFileSync(join(brainstormDir, "projects.json"), JSON.stringify([{ id: "PROJ", name: "DB Project", description: "schema", hasUi: false, concept: { summary: "db", problem: "db", users: ["ops"], constraints: [] } }], null, 2))
    writeFileSync(join(requirementsDir, "prd.json"), JSON.stringify({ prd: { id: "PRD", title: "DB", stories: [] } }, null, 2))
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
          {
            id: "W2",
            number: 2,
            goal: "schema",
            kind: "feature",
            stories: [{ id: "US-2", title: "schema", dbRelevant: true }],
            dbRelevantStoryCount: 1,
            dbRelevantWave: true,
            internallyParallelizable: false,
            dependencies: ["W1"],
            exitCriteria: [],
          },
        ],
      },
    }, null, 2))
    await writeRecoveryRecord(ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "stage", runId: run.id, stageId: "execution" },
      summary: "Retry Supabase readiness.",
      evidencePaths: [planningDir],
    })
    repos.setRunRecovery(run.id, { status: "blocked", scope: "stage", scopeRef: "execution", summary: "Retry Supabase readiness." })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "resume_run", "--remediation-summary", "setup changed"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        timeout: 10000,
      },
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Workflow start blocked by Supabase readiness/)
    assert.match(result.stderr ?? "", /Workspace: alpha/)
    assert.match(result.stderr ?? "", /planned DB-relevant waves require Supabase readiness before execution workers start/)
    assert.match(result.stderr ?? "", /Store management token/)
    assert.match(result.stderr ?? "", /Connect Supabase project/)
    assert.match(result.stderr ?? "", /Create persistent test branch/)
    assert.match(result.stderr ?? "", /beerengineer setup/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    const runs = verifyRepos.listRuns().filter(candidate => candidate.item_id === item.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.id, run.id)
    assert.equal(runs[0]?.status, "blocked")
    assert.equal(runs[0]?.recovery_status, "blocked")
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
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath },
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

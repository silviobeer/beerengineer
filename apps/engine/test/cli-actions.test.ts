import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { layout } from "../src/core/workspaceLayout.js"

test("beerengineer item action start_brainstorm runs to completion through the terminal CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
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
          "ok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\nok\n",
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
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer item action start_implementation resumes from brainstorm artifacts as a cli-owned run", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  let workspaceIdForCleanup: string | null = null

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    const item = repos.createItem({
      workspaceId: ws.id,
      code: "ITEM-0001",
      title: "CLI Implementation",
      description: "resume from brainstorm",
    })
    repos.setItemColumn(item.id, "requirements", "draft")
    const seedRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    db.close()

    const workspaceId = `cli-implementation-${item.id.toLowerCase()}`
    workspaceIdForCleanup = workspaceId
    const previousCwd = process.cwd()
    try {
      process.chdir(engineRoot)
      const brainstormDir = layout.stageArtifactsDir({ workspaceId, runId: seedRun.id }, "brainstorm")
      rmSync(layout.workspaceDir(workspaceId), { recursive: true, force: true })
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
          ...Array.from({ length: 16 }, () => "accept"),
          ...Array.from({ length: 16 }, () => "merge"),
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
      if (workspaceIdForCleanup) rmSync(layout.workspaceDir(workspaceIdForCleanup), { recursive: true, force: true })
    } finally {
      process.chdir(previousCwd)
    }
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
  }
})

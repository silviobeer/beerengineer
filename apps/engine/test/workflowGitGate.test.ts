import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { startPreparedImportForItem, startRunForItem } from "../src/core/runService.js"
import { defaultAppConfig } from "../src/setup/config.js"

function tempWorkflowGitEnv() {
  const dir = mkdtempSync(join(tmpdir(), "be2-workflow-git-gate-"))
  return {
    dir,
    repo: join(dir, "repo"),
    attackerRepo: join(dir, "attacker"),
    globalGitConfig: join(dir, "global.gitconfig"),
  }
}

function configForRoot(rootPath: string) {
  return { ...defaultAppConfig(), allowedRoots: [rootPath] }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

function initRepo(path: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync("git", ["init", "-b", "main", path], { env, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test("AC-1 AC-2 AC-3 workflow start blocks missing git identity before run side effects", () => {
  const paths = tempWorkflowGitEnv()
  const db = initDatabase(":memory:")
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(paths.repo, env)
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: paths.repo })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Needs identity", description: "start" })

    const result = startRunForItem(repos, {
      itemId: item.id,
      action: "start_brainstorm",
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { env },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 409)
      assert.equal(result.error, "git_identity_missing")
      assert.match(result.message, /Git identity/i)
      assert.match(result.message, /repair/i)
      assert.equal(result.readiness?.blocker?.error, "identity_missing")
      assert.deepEqual(result.intent, { itemId: item.id, action: "start_brainstorm" })
      assert.equal(result.repair?.workspaceId, workspace.id)
    }
    assert.equal(repos.listRuns().length, 0)
    assert.equal(git(paths.repo, ["branch", "--list", "item/*"], env), "")
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-4 workflow start reports missing git separately from missing identity", () => {
  const paths = tempWorkflowGitEnv()
  const db = initDatabase(":memory:")
  try {
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: paths.repo })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Needs git", description: "start" })

    const result = startRunForItem(repos, {
      itemId: item.id,
      action: "start_brainstorm",
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { gitBin: "__beerengineer_missing_git__" },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 409)
      assert.equal(result.error, "git_not_installed")
      assert.equal(result.readiness?.blocker?.error, "git_not_installed")
    }
    assert.equal(repos.listRuns().length, 0)
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-5 AC-6 AC-8 workflow start ignores client-supplied workspaceRoot and checks registered workspace", () => {
  const paths = tempWorkflowGitEnv()
  const db = initDatabase(":memory:")
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(paths.repo, env)
    initRepo(paths.attackerRepo, env)
    git(paths.attackerRepo, ["config", "--local", "user.name", "Attacker User"], env)
    git(paths.attackerRepo, ["config", "--local", "user.email", "attacker@example.test"], env)
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: paths.repo })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Server path", description: "start" })

    const result = startRunForItem(repos, {
      itemId: item.id,
      action: "start_brainstorm",
      workspaceRoot: paths.attackerRepo,
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { env },
    } as Parameters<typeof startRunForItem>[1] & { workspaceRoot: string })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, "git_identity_missing")
      assert.equal(result.readiness?.workspace.id, workspace.id)
      assert.equal(result.readiness?.repoLocalIdentity.email, undefined)
    }
    assert.equal(repos.listRuns().length, 0)
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-7 workflow start blocks deleted workspace paths before git side effects", () => {
  const paths = tempWorkflowGitEnv()
  const db = initDatabase(":memory:")
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: join(paths.dir, "deleted") })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Deleted path", description: "start" })

    const result = startRunForItem(repos, {
      itemId: item.id,
      action: "start_brainstorm",
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { env },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 409)
      assert.equal(result.error, "workspace_path_unavailable")
    }
    assert.equal(repos.listRuns().length, 0)
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("prepared import blocks missing git identity before run, item, and artifact side effects", async () => {
  const paths = tempWorkflowGitEnv()
  const db = initDatabase(":memory:")
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(paths.repo, env)
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: paths.repo })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Prepared import", description: "start" })

    const result = await startPreparedImportForItem(repos, {
      itemId: item.id,
      sourceDir: join(paths.dir, "missing-import-source"),
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { env },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 409)
      assert.equal(result.error, "git_identity_missing")
      assert.equal(result.code, "workflow_git_blocked")
      assert.deepEqual(result.intent, { itemId: item.id, action: "import_prepared" })
    }
    assert.equal(repos.listRuns().length, 0)
    assert.equal(repos.getItem(item.id)?.current_column, "idea")
    assert.equal(existsSync(join(paths.repo, ".beerengineer")), false)
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("prepared import for a new item checks git readiness in the selected workspace", async () => {
  const paths = tempWorkflowGitEnv()
  const betaRepo = join(paths.dir, "beta")
  const db = initDatabase(":memory:")
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(paths.repo, env)
    initRepo(betaRepo, env)
    git(paths.repo, ["config", "--local", "user.name", "Default User"], env)
    git(paths.repo, ["config", "--local", "user.email", "default@example.test"], env)
    const repos = new Repos(db)
    const defaultWorkspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: paths.repo })
    const betaWorkspace = repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: betaRepo })

    const result = await startPreparedImportForItem(repos, {
      sourceDir: join(paths.dir, "prepared-import"),
      workspaceKey: "beta",
      appConfig: configForRoot(paths.dir),
      gitCommandOptions: { env },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 409)
      assert.equal(result.error, "git_identity_missing")
      assert.equal(result.readiness?.workspace.id, betaWorkspace.id)
      assert.notEqual(result.readiness?.workspace.id, defaultWorkspace.id)
    }
    assert.equal(repos.listRuns().length, 0)
    assert.deepEqual(repos.listItemsForWorkspace(defaultWorkspace.id), [])
    assert.deepEqual(repos.listItemsForWorkspace(betaWorkspace.id), [])
  } finally {
    db.close()
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

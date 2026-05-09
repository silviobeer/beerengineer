import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { defaultAppConfig } from "../src/setup/config.js"
import {
  readGlobalGitReadiness,
  readWorkspaceGitReadiness,
} from "../src/setup/gitIdentity.js"

function tempGitEnv(prefix = "be2-git-identity-readiness-") {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    globalGitConfig: join(dir, "global.gitconfig"),
  }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function initRepo(dir: string, env: NodeJS.ProcessEnv): void {
  mkdirSync(dir, { recursive: true })
  git(dir, ["init", "-b", "main"], env)
}

function configForRoot(rootPath: string) {
  return { ...defaultAppConfig(), allowedRoots: [rootPath] }
}

test("AC-1 global readiness reports git install, global identity, app default, and actions", () => {
  const paths = tempGitEnv()
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    spawnSync("git", ["config", "--global", "user.name", "Global User"], { env })
    spawnSync("git", ["config", "--global", "user.email", "global@example.test"], { env })

    const readiness = readGlobalGitReadiness({
      ...defaultAppConfig(),
      gitIdentityDefault: { displayName: "App User", email: "app@example.test", localOnly: false },
    }, { env })

    assert.equal(readiness.mode, "global")
    assert.equal(readiness.git.installed, true)
    assert.equal(readiness.globalIdentity.name, "Global User")
    assert.equal(readiness.globalIdentity.email, "global@example.test")
    assert.equal(readiness.appDefaultIdentity?.displayName, "App User")
    assert.equal(readiness.appDefaultIdentity?.email, "app@example.test")
    assert.deepEqual(readiness.availableActions, ["save_app_default"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-2 missing identity blocks workflow readiness without crashing setup", () => {
  const paths = tempGitEnv()
  try {
    const readiness = readGlobalGitReadiness(defaultAppConfig(), {
      env: { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig },
    })

    assert.equal(readiness.git.installed, true)
    assert.equal(readiness.setupBlocked, false)
    assert.equal(readiness.workflowBlocked, true)
    assert.equal(readiness.blocker?.error, "identity_missing")
    assert.equal(readiness.displayMode.mode, "action-required")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-3 global readiness distinguishes missing git from missing identity", () => {
  const readiness = readGlobalGitReadiness(defaultAppConfig(), { gitBin: "__beerengineer_missing_git__" })

  assert.equal(readiness.git.installed, false)
  assert.equal(readiness.setupBlocked, true)
  assert.equal(readiness.workflowBlocked, true)
  assert.equal(readiness.blocker?.error, "git_not_installed")
})

test("AC-4 readiness snapshots contain no raw secrets or tokens", () => {
  const readiness = readGlobalGitReadiness({
    ...defaultAppConfig(),
    llm: { ...defaultAppConfig().llm, apiKeyRef: "sk-secret-ref" },
    gitIdentityDefault: { displayName: "Safe User", email: "safe@example.test", localOnly: false },
  })
  const serialized = JSON.stringify(readiness)

  assert.doesNotMatch(serialized, /sk-secret-ref/)
  assert.doesNotMatch(serialized, /TOKEN|SECRET/)
})

test("AC-5 workspace readiness reports whether registered workspace is a git repo", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const nonRepo = join(paths.dir, "non-repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)
    mkdirSync(nonRepo, { recursive: true })

    assert.equal(readWorkspaceGitReadiness({ id: "w1", key: "repo", rootPath: repo }, configForRoot(paths.dir), { env }).isGitRepo, true)
    assert.equal(readWorkspaceGitReadiness({ id: "w2", key: "non-repo", rootPath: nonRepo }, configForRoot(paths.dir), { env }).isGitRepo, false)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-6 repo-local identity wins before global and app-level identity", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)
    git(repo, ["config", "--local", "user.name", "Repo User"], env)
    git(repo, ["config", "--local", "user.email", "repo@example.test"], env)
    spawnSync("git", ["config", "--global", "user.name", "Global User"], { env })
    spawnSync("git", ["config", "--global", "user.email", "global@example.test"], { env })

    const readiness = readWorkspaceGitReadiness(
      { id: "w1", key: "repo", rootPath: repo },
      { ...configForRoot(paths.dir), gitIdentityDefault: { displayName: "App User", email: "app@example.test", localOnly: false } },
      { env },
    )

    assert.equal(readiness.effectiveIdentity?.source, "repo-local")
    assert.equal(readiness.effectiveIdentity?.email, "repo@example.test")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-7 global identity makes workspace ready when repo-local is absent", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)
    spawnSync("git", ["config", "--global", "user.name", "Global User"], { env })
    spawnSync("git", ["config", "--global", "user.email", "global@example.test"], { env })

    const readiness = readWorkspaceGitReadiness({ id: "w1", key: "repo", rootPath: repo }, configForRoot(paths.dir), { env })

    assert.equal(readiness.ready, true)
    assert.equal(readiness.effectiveIdentity?.source, "global")
    assert.equal(readiness.displayMode.mode, "ready")
    assert.deepEqual(readiness.displayMode.freshness.invalidatedBy, ["setup_recheck", "workspace_changed", "workspace_git_identity_repaired"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-8 app-level default exposes workspace repair action instead of ready state", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)

    const readiness = readWorkspaceGitReadiness(
      { id: "w1", key: "repo", rootPath: repo },
      { ...configForRoot(paths.dir), gitIdentityDefault: { displayName: "App User", email: "app@example.test", localOnly: false } },
      { env },
    )

    assert.equal(readiness.ready, false)
    assert.equal(readiness.workflowBlocked, true)
    assert.deepEqual(readiness.availableActions, ["repair_workspace_identity"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-9 missing all identity sources reports workflow blocker with repair hint", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)

    const readiness = readWorkspaceGitReadiness({ id: "w1", key: "repo", rootPath: repo }, configForRoot(paths.dir), { env })

    assert.equal(readiness.workflowBlocked, true)
    assert.deepEqual(readiness.availableActions, ["repair_workspace_identity"])
    assert.equal(readiness.blocker?.error, "identity_missing")
    assert.match(readiness.blocker?.message ?? "", /Git identity/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("workspace readiness refuses registered paths outside allowed roots before reading repo identity", () => {
  const paths = tempGitEnv()
  try {
    const repo = join(paths.dir, "repo")
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    initRepo(repo, env)
    git(repo, ["config", "--local", "user.name", "Repo User"], env)
    git(repo, ["config", "--local", "user.email", "repo@example.test"], env)

    const readiness = readWorkspaceGitReadiness(
      { id: "w1", key: "repo", rootPath: repo },
      configForRoot(join(paths.dir, "allowed")),
      { env },
    )

    assert.equal(readiness.isGitRepo, false)
    assert.equal(readiness.repoLocalIdentity.email, undefined)
    assert.equal(readiness.workflowBlocked, true)
    assert.equal(readiness.blocker?.error, "workspace_path_unavailable")
    assert.match(readiness.blocker?.message ?? "", /allowed roots/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

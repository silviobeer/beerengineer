import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { defaultAppConfig } from "../src/setup/config.js"
import {
  repairWorkspaceGitIdentity,
  readWorkspaceGitReadiness,
} from "../src/setup/gitIdentity.js"

function tempRepoEnv() {
  const dir = mkdtempSync(join(tmpdir(), "be2-git-identity-repair-"))
  return {
    dir,
    repo: join(dir, "repo"),
    globalGitConfig: join(dir, "global.gitconfig"),
  }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test("AC-20 workspace repair accepts workspace identity and git identity data, not trusted root path", () => {
  const paths = tempRepoEnv()
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    spawnSync("git", ["init", "-b", "main", paths.repo], { env, encoding: "utf8" })

    const result = repairWorkspaceGitIdentity(
      { id: "workspace-id", key: "demo", rootPath: paths.repo },
      defaultAppConfig(),
      { displayName: "Repo User", email: "repo@example.test" },
      { env },
    )

    assert.equal(result.ok, true)
    assert.equal(readWorkspaceGitReadiness({ id: "workspace-id", key: "demo", rootPath: paths.repo }, defaultAppConfig(), { env }).repoLocalIdentity.email, "repo@example.test")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-21 repair writes to the server-resolved workspace root", () => {
  const paths = tempRepoEnv()
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }
    spawnSync("git", ["init", "-b", "main", paths.repo], { env, encoding: "utf8" })

    const result = repairWorkspaceGitIdentity(
      { id: "workspace-id", key: "demo", rootPath: paths.repo },
      defaultAppConfig(),
      { displayName: "Repo User", email: "repo@example.test" },
      { env },
    )

    assert.equal(result.ok, true)
    const email = spawnSync("git", ["config", "--local", "--get", "user.email"], { cwd: paths.repo, env, encoding: "utf8" })
    assert.equal(email.stdout.trim(), "repo@example.test")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-23 unavailable workspace roots fail clearly without git side effects", () => {
  const paths = tempRepoEnv()
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: paths.globalGitConfig }

    const result = repairWorkspaceGitIdentity(
      { id: "workspace-id", key: "demo", rootPath: join(paths.dir, "missing") },
      defaultAppConfig(),
      { displayName: "Repo User", email: "repo@example.test" },
      { env },
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, "workspace_path_unavailable")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

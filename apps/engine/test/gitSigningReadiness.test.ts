import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { classifyGitCommitFailure } from "../src/core/git/commit.js"
import { defaultAppConfig } from "../src/setup/config.js"
import { readWorkspaceGitReadiness } from "../src/setup/gitIdentity.js"

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync<string>> {
  return spawnSync("git", args, { cwd, env, encoding: "utf8" })
}

test("AC-20 AC-21 commit.gpgsign=true is commit_signing_blocked, not missing identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-git-signing-"))
  const repo = join(dir, "repo")
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "global.gitconfig") }
  try {
    assert.equal(spawnSync("git", ["init", "-b", "main", repo], { env, encoding: "utf8" }).status, 0)
    assert.equal(git(repo, ["config", "--local", "user.name", "Signing User"], env).status, 0)
    assert.equal(git(repo, ["config", "--local", "user.email", "signing@example.test"], env).status, 0)
    assert.equal(git(repo, ["config", "--local", "commit.gpgsign", "true"], env).status, 0)
    assert.equal(git(repo, ["config", "--local", "gpg.program", "__beerengineer_missing_gpg__"], env).status, 0)
    writeFileSync(join(repo, "signed.txt"), "signed\n")
    assert.equal(git(repo, ["add", "-A"], env).status, 0)

    const commit = git(repo, ["commit", "-m", "signed commit"], env)
    assert.notEqual(commit.status, 0)
    assert.equal(classifyGitCommitFailure(commit.stderr), "commit_signing_blocked")

    const readiness = readWorkspaceGitReadiness({ id: "ws-1", key: "demo", rootPath: repo }, defaultAppConfig(), { env })
    assert.equal(readiness.ready, true)
    assert.equal(readiness.effectiveIdentity?.source, "repo-local")
    assert.notEqual(readiness.blocker?.error, "identity_missing")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

test("AC-18 AC-19 partial repair returns fresh name/email state and is not successful", (t) => {
  if (process.platform === "win32") {
    t.skip("bash script not available on Windows")
    return
  }
  const paths = tempRepoEnv()
  try {
    const nameFile = join(paths.dir, "name.txt")
    const emailFile = join(paths.dir, "email.txt")
    const gitBin = join(paths.dir, "git-wrapper.sh")
    mkdirSync(paths.repo, { recursive: true })
    writeFileSync(gitBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--version" ]]; then echo "git version wrapper"; exit 0; fi
if [[ "$1 $2" == "rev-parse --is-inside-work-tree" ]]; then echo true; exit 0; fi
if [[ "$1 $2 $3" == "config --global --get" ]]; then exit 1; fi
if [[ "$1 $2 $3" == "config --local --get" ]]; then
  if [[ "$4" == "user.name" && -f "${nameFile}" ]]; then cat "${nameFile}"; exit 0; fi
  if [[ "$4" == "user.email" && -f "${emailFile}" ]]; then cat "${emailFile}"; exit 0; fi
  exit 1
fi
if [[ "$1 $2" == "config --local" ]]; then
  if [[ "$3" == "user.name" ]]; then printf "%s\\n" "$4" > "${nameFile}"; exit 0; fi
  if [[ "$3" == "user.email" ]]; then exit 1; fi
fi
exit 1
`)
    chmodSync(gitBin, 0o755)

    const result = repairWorkspaceGitIdentity(
      { id: "workspace-id", key: "demo", rootPath: paths.repo },
      defaultAppConfig(),
      { displayName: "Only Name", email: "repair@example.test" },
      { gitBin },
    )

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, "repair_partial_failure")
      assert.deepEqual(result.actions, ["git config --local user.name"])
      assert.equal(result.readiness?.repoLocalIdentity.name, "Only Name")
      assert.equal(result.readiness?.repoLocalIdentity.email, undefined)
      assert.equal(result.readiness?.ready, false)
    }
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

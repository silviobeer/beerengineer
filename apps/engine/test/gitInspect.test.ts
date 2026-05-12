import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import {
  dirtyPathMatchesAllowlist,
  inspectWorkspaceState,
  resolveDirtyMasterAllowlistPatterns,
} from "../src/core/git.js"

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}

test("workspace inspection can ignore a prepared import folder while still blocking other dirty files", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-git-inspect-"))
  try {
    git(root, ["init", "--initial-branch=main"])
    git(root, ["config", "user.email", "test@example.invalid"])
    git(root, ["config", "user.name", "test"])
    writeFileSync(join(root, "README.md"), "seed\n")
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "seed"])

    const preparedDir = join(root, "specs", "PROJ-1-demo")
    mkdirSync(preparedDir, { recursive: true })
    writeFileSync(join(preparedDir, "concept.md"), "# PROJ-1: Demo\n")

    assert.equal(inspectWorkspaceState(root).kind, "dirty")
    assert.equal(inspectWorkspaceState(root, { ignoredPaths: [preparedDir] }).kind, "ok")

    writeFileSync(join(root, "src.txt"), "real dirty work\n")
    assert.equal(inspectWorkspaceState(root, { ignoredPaths: [preparedDir] }).kind, "dirty")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("dirty-master allowlist matching normalizes repo-relative paths", () => {
  assert.equal(dirtyPathMatchesAllowlist("tmp/locks/current.lock", ["./tmp/**/*.lock"]), true)
  assert.equal(dirtyPathMatchesAllowlist("./tmp/locks/current.lock", ["tmp/**/*.lock"]), true)
  assert.equal(dirtyPathMatchesAllowlist("tmp/locks/current.txt", ["tmp/**/*.lock"]), false)
})

test("workspace inspection treats fully allowlisted master dirt as clean but still blocks mixed dirt", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-git-allowlist-"))
  try {
    git(root, ["init", "--initial-branch=master"])
    git(root, ["config", "user.email", "test@example.invalid"])
    git(root, ["config", "user.name", "test"])
    writeFileSync(join(root, "README.md"), "seed\n")
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "seed"])

    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({
        schemaVersion: 2,
        key: "allowlist",
        name: "Allowlist",
        harnessProfile: { mode: "fast" },
        runtimePolicy: {
          stageAuthoring: "safe-readonly",
          reviewer: "safe-readonly",
          coderExecution: "unsafe-autonomous-write",
        },
        dirtyMasterAllowlist: ["tmp/**/*.lock"],
        sonar: { enabled: false },
        reviewPolicy: {
          coderabbit: { enabled: false },
          sonarcloud: { enabled: false },
        },
        createdAt: Date.now(),
      }, null, 2),
    )

    mkdirSync(join(root, ".claude"), { recursive: true })
    mkdirSync(join(root, "tmp", "locks"), { recursive: true })
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "locked\n")
    writeFileSync(join(root, "tmp", "locks", "current.lock"), "temp\n")

    const allowlist = resolveDirtyMasterAllowlistPatterns(root)
    assert.equal(inspectWorkspaceState(root, { allowlistPatterns: allowlist }).kind, "ok")

    writeFileSync(join(root, "real-dirty.txt"), "block me\n")
    assert.equal(inspectWorkspaceState(root, { allowlistPatterns: allowlist }).kind, "dirty")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

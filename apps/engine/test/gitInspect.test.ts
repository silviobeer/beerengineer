import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { inspectWorkspaceState } from "../src/core/git.js"

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

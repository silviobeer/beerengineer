import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import {
  isEngineOwnedBranchName,
  resolveBaseBranchForItem,
  resolveBaseBranchForWorkspace,
} from "../src/core/baseBranch.js"

function seedRepo(initialBranch: string): string {
  const root = mkdtempSync(join(tmpdir(), "be2-basebranch-"))
  spawnSync("git", ["init", `--initial-branch=${initialBranch}`], { cwd: root })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root })
  return root
}

test("isEngineOwnedBranchName flags engine branches but not user branches", () => {
  assert.equal(isEngineOwnedBranchName("item/foo"), true)
  assert.equal(isEngineOwnedBranchName("proj/foo__p1"), true)
  assert.equal(isEngineOwnedBranchName("wave/foo__p1__w1"), true)
  assert.equal(isEngineOwnedBranchName("story/foo__p1__w1__s1"), true)
  assert.equal(isEngineOwnedBranchName("candidate/r__foo__p1"), true)
  assert.equal(isEngineOwnedBranchName("main"), false)
  assert.equal(isEngineOwnedBranchName("master"), false)
  assert.equal(isEngineOwnedBranchName("develop"), false)
  assert.equal(isEngineOwnedBranchName("feature/x"), false)
})

test("resolveBaseBranchForWorkspace honors env override first", () => {
  const prev = process.env.BEERENGINEER_BASE_BRANCH
  process.env.BEERENGINEER_BASE_BRANCH = "trunk"
  try {
    const r = resolveBaseBranchForWorkspace(undefined)
    assert.deepEqual(r, { branch: "trunk", source: "env" })
  } finally {
    if (prev === undefined) delete process.env.BEERENGINEER_BASE_BRANCH
    else process.env.BEERENGINEER_BASE_BRANCH = prev
  }
})

test("resolveBaseBranchForWorkspace prefers workspace.json over git probe", () => {
  const prev = process.env.BEERENGINEER_BASE_BRANCH
  delete process.env.BEERENGINEER_BASE_BRANCH
  const root = seedRepo("main")
  try {
    mkdirSync(join(root, ".beerengineer"), { recursive: true })
    writeFileSync(
      join(root, ".beerengineer", "workspace.json"),
      JSON.stringify({ preflight: { github: { defaultBranch: "develop" } } }),
    )
    const r = resolveBaseBranchForWorkspace(root)
    assert.deepEqual(r, { branch: "develop", source: "config" })
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (prev !== undefined) process.env.BEERENGINEER_BASE_BRANCH = prev
  }
})

test("resolveBaseBranchForWorkspace falls back to git current branch then 'main'", () => {
  const prev = process.env.BEERENGINEER_BASE_BRANCH
  delete process.env.BEERENGINEER_BASE_BRANCH
  const root = seedRepo("trunk")
  try {
    const r = resolveBaseBranchForWorkspace(root)
    // No origin/HEAD, so we fall through to the current-branch probe.
    assert.equal(r.source, "git")
    assert.equal(r.branch, "trunk")
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (prev !== undefined) process.env.BEERENGINEER_BASE_BRANCH = prev
  }

  const r2 = resolveBaseBranchForWorkspace(undefined)
  assert.deepEqual(r2, { branch: "main", source: "default" })
})

test("resolveBaseBranchForWorkspace refuses engine-owned branches from git probe", () => {
  const prev = process.env.BEERENGINEER_BASE_BRANCH
  delete process.env.BEERENGINEER_BASE_BRANCH
  const root = seedRepo("main")
  try {
    spawnSync("git", ["checkout", "-b", "story/demo-item__p1__w1__s1"], { cwd: root })
    const r = resolveBaseBranchForWorkspace(root)
    // Should not adopt the engine-owned current branch; falls through to default.
    assert.equal(r.source, "default")
    assert.equal(r.branch, "main")
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (prev !== undefined) process.env.BEERENGINEER_BASE_BRANCH = prev
  }
})

test("resolveBaseBranchForItem uses the item override when provided", () => {
  const r = resolveBaseBranchForItem("release/2025", undefined)
  assert.deepEqual(r, { branch: "release/2025", source: "item" })
})

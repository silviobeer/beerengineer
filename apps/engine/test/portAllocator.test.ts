import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import {
  assignPort,
  lookupPort,
  previewUrlForWorktree,
  pruneMissingWorktreeAssignments,
  releasePort,
} from "../src/core/portAllocator.js"
import { previewHost } from "../src/core/previewHost.js"

let rootDir: string
let dbPath: string
let oldDbPath: string | undefined

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "be2-portalloc-"))
  dbPath = join(rootDir, "test.sqlite")
  oldDbPath = process.env.BEERENGINEER_UI_DB_PATH
  process.env.BEERENGINEER_UI_DB_PATH = dbPath
  initDatabase(dbPath).close()
})

afterEach(() => {
  if (oldDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
  else process.env.BEERENGINEER_UI_DB_PATH = oldDbPath
})

test("assignPort is idempotent for the same worktree", () => {
  const worktree = join(rootDir, "item-worktree")
  mkdirSync(worktree, { recursive: true })
  const first = assignPort(worktree, "item/demo")
  const second = assignPort(worktree, "item/demo")
  assert.equal(first, second)
  assert.equal(lookupPort(worktree), first)
  assert.equal(previewUrlForWorktree(worktree), `http://${previewHost()}:${first}`)
})

test("assignPort returns distinct ports for distinct worktrees", () => {
  const worktreeA = join(rootDir, "wt-a")
  const worktreeB = join(rootDir, "wt-b")
  mkdirSync(worktreeA, { recursive: true })
  mkdirSync(worktreeB, { recursive: true })
  const a = assignPort(worktreeA, "item/demo")
  const b = assignPort(worktreeB, "story/demo")
  assert.notEqual(a, b)
})

test("releasePort frees an assignment", () => {
  const worktree = join(rootDir, "wt-release")
  mkdirSync(worktree, { recursive: true })
  const assigned = assignPort(worktree, "item/release")
  assert.equal(lookupPort(worktree), assigned)
  releasePort(worktree)
  assert.equal(lookupPort(worktree), null)
})

test("workspace config overrides the default port pool", () => {
  const configDir = join(rootDir, ".beerengineer")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "workspace.json"),
    JSON.stringify({ worktreePortPool: { start: 3500, end: 3501 } }, null, 2),
  )
  const worktree = join(rootDir, "configured")
  mkdirSync(worktree, { recursive: true })
  const port = assignPort(worktree, "item/configured", rootDir)
  assert.ok(port === 3500 || port === 3501)
})

test("assignPort applies the worktree-port schema on a fresh openDatabase-only DB", () => {
  const freshRoot = mkdtempSync(join(tmpdir(), "be2-portalloc-fresh-"))
  const freshDbPath = join(freshRoot, "fresh.sqlite")
  process.env.BEERENGINEER_UI_DB_PATH = freshDbPath
  const worktree = join(freshRoot, "fresh-worktree")
  mkdirSync(worktree, { recursive: true })

  const port = assignPort(worktree, "item/fresh")

  assert.equal(typeof port, "number")
  assert.equal(lookupPort(worktree), port)
})

test("assignPort throws a dedicated error when the pool is exhausted", () => {
  const configDir = join(rootDir, ".beerengineer")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "workspace.json"),
    JSON.stringify({ worktreePortPool: { start: 3500, end: 3500 } }, null, 2),
  )
  const worktreeA = join(rootDir, "pool-a")
  const worktreeB = join(rootDir, "pool-b")
  mkdirSync(worktreeA, { recursive: true })
  mkdirSync(worktreeB, { recursive: true })

  assert.equal(assignPort(worktreeA, "item/a", rootDir), 3500)
  assert.throws(() => assignPort(worktreeB, "item/b", rootDir), /worktree_port_pool_exhausted/)
})

test("pruneMissingWorktreeAssignments removes orphaned rows", () => {
  const missing = join(rootDir, "missing-worktree")
  assert.equal(existsSync(missing), false)
  assignPort(missing, "item/missing")
  assert.ok(lookupPort(missing) !== null)
  const removed = pruneMissingWorktreeAssignments()
  assert.equal(removed, 1)
  assert.equal(lookupPort(missing), null)
})

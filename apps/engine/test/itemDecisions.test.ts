import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appendItemDecision, loadItemDecisions } from "../src/core/itemDecisions.js"
import { layout } from "../src/core/workspaceLayout.js"

function withCwd<T>(dir: string, fn: () => T): T {
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return fn()
  } finally {
    process.chdir(prev)
  }
}

test("loadItemDecisions returns [] when no file exists or workspaceId is empty", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    withCwd(root, () => {
      assert.deepEqual(loadItemDecisions(undefined), [])
      assert.deepEqual(loadItemDecisions("does-not-exist"), [])
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("appendItemDecision persists and roundtrips through loadItemDecisions", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    withCwd(root, () => {
      appendItemDecision("ws-1", {
        id: "p-1",
        stage: "requirements",
        question: "Cancel Run scope?",
        answer: "Drop from scope",
        runId: "r-1",
        answeredAt: "2026-04-25T12:00:00Z",
      })
      const decisions = loadItemDecisions("ws-1")
      assert.equal(decisions.length, 1)
      assert.equal(decisions[0].id, "p-1")
      assert.equal(decisions[0].answer, "Drop from scope")
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("appendItemDecision overwrites the same prompt id with the latest answer", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    withCwd(root, () => {
      const base = { id: "p-2", stage: "requirements", question: "Q?", runId: "r-1", answeredAt: "2026-04-25T12:00:00Z" }
      appendItemDecision("ws-2", { ...base, answer: "first answer" })
      appendItemDecision("ws-2", { ...base, answer: "second answer", answeredAt: "2026-04-25T13:00:00Z" })
      const decisions = loadItemDecisions("ws-2")
      assert.equal(decisions.length, 1)
      assert.equal(decisions[0].answer, "second answer")
      assert.equal(decisions[0].answeredAt, "2026-04-25T13:00:00Z")
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("loadItemDecisions returns [] for a corrupted decisions.json", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    withCwd(root, () => {
      const dir = layout.workspaceDir("ws-3")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "decisions.json"), "{not json", "utf8")
      assert.deepEqual(loadItemDecisions("ws-3"), [])
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

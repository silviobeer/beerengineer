import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appendItemDecision, loadItemDecisions } from "../src/core/itemDecisions.js"
import { layout } from "../src/core/workspaceLayout.js"

test("loadItemDecisions returns [] when no file exists or workspaceId is empty", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    assert.deepEqual(loadItemDecisions(undefined), [])
    assert.deepEqual(loadItemDecisions({ workspaceId: "does-not-exist", workspaceRoot: root }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("appendItemDecision persists and roundtrips through loadItemDecisions", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    const ctx = { workspaceId: "ws-1", workspaceRoot: root }
    appendItemDecision(ctx, {
      id: "p-1",
      stage: "requirements",
      question: "Cancel Run scope?",
      answer: "Drop from scope",
      runId: "r-1",
      answeredAt: "2026-04-25T12:00:00Z",
    })
    const decisions = loadItemDecisions(ctx)
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].id, "p-1")
    assert.equal(decisions[0].answer, "Drop from scope")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("appendItemDecision overwrites the same prompt id with the latest answer", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    const ctx = { workspaceId: "ws-2", workspaceRoot: root }
    const base = { id: "p-2", stage: "requirements", question: "Q?", runId: "r-1", answeredAt: "2026-04-25T12:00:00Z" }
    appendItemDecision(ctx, { ...base, answer: "first answer" })
    appendItemDecision(ctx, { ...base, answer: "second answer", answeredAt: "2026-04-25T13:00:00Z" })
    const decisions = loadItemDecisions(ctx)
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].answer, "second answer")
    assert.equal(decisions[0].answeredAt, "2026-04-25T13:00:00Z")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("loadItemDecisions returns [] for a corrupted decisions.json", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-decisions-"))
  try {
    const ctx = { workspaceId: "ws-3", workspaceRoot: root }
    const dir = layout.workspaceDir(ctx)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "decisions.json"), "{not json", "utf8")
    assert.deepEqual(loadItemDecisions(ctx), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

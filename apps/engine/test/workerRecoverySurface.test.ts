import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getBoard } from "../src/api/board.js"
import { recoveryUserMessageForRun } from "../src/core/recoveryUserMessage.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

function fixture() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-recovery-surface-")), "test.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Recovered item", description: "summary" })
  return { db, repos, ws, item }
}

test("board cards expose a user-facing lost-worker recovery message without a DB column", () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, {
      status: "failed",
      recovery_status: "failed",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: "API restart lost API worker ownership — no live worker; resume or abandon.",
    })

    const board = getBoard(db, "test")
    const cards = board.columns.flatMap(column => column.cards)
    assert.equal(cards[0]?.recovery_user_message, "Worker lost. Resume this run to continue.")
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('runs') WHERE name = 'recovery_user_message'").get().n,
      0,
    )
  } finally {
    db.close()
  }
})

test("recovery user message falls back safely for non-worker recovery", () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, {
      status: "failed",
      recovery_status: "blocked",
      recovery_scope: "story",
      recovery_scope_ref: "1/US-1",
      recovery_summary: "Reviewer blocked the story.",
    })

    assert.equal(recoveryUserMessageForRun(repos.getRun(run.id)!), null)
  } finally {
    db.close()
  }
})

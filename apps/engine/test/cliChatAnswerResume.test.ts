import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runChatAnswerCommand } from "../src/cli/commands/overview.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

test("chat answer resumes a blocked run through the CLI flow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-chat-answer-resume-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0900", title: "blocked item", description: "resume" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, {
      current_stage: "requirements",
      status: "blocked",
      recovery_status: "blocked",
      recovery_scope: "stage",
      recovery_scope_ref: "requirements",
      recovery_summary: "Waiting for prompt answer.",
    })
    repos.createPendingPrompt({ id: "p-cli-resume", runId: run.id, prompt: "Need more detail?" })

    const resumedRunIds: string[] = []
    const exitCode = await runChatAnswerCommand(
      {
        kind: "chat-answer",
        promptId: "p-cli-resume",
        answer: "Use the CLI resume path.",
        multiline: false,
        editor: false,
        json: false,
      },
      {
        resumeBlockedRunAfterCliAnswerImpl: async (_repos, runId) => {
          resumedRunIds.push(runId)
          return { ok: true }
        },
      },
    )

    assert.equal(exitCode, 0)
    assert.deepEqual(resumedRunIds, [run.id])
    assert.equal(repos.getPendingPrompt("p-cli-resume")?.answer, "Use the CLI resume path.")
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

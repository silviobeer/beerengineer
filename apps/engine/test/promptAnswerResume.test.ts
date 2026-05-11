import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeRecoveryRecord } from "../src/core/recovery.js"
import { answerRunPromptInProcess } from "../src/core/runService.js"
import { layout } from "../src/core/workspaceLayout.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

type BackgroundHarness = {
  backgroundRunner: Parameters<typeof answerRunPromptInProcess>[2]["backgroundRunner"]
  wait(): Promise<void>
}

function createBackgroundHarness(): BackgroundHarness {
  const tasks: Promise<void>[] = []
  return {
    backgroundRunner(io, _label, task) {
      tasks.push(task().finally(() => io.close?.()))
    },
    async wait() {
      await Promise.all(tasks)
    },
  }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompt-answer-resume-"))
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
}

async function seedBlockedPromptRun() {
  const db = initDatabase(join(process.cwd(), "test.sqlite"))
  const repos = new Repos(db)
  const workspaceRoot = join(process.cwd(), "repo")
  mkdirSync(workspaceRoot, { recursive: true })
  const workspace = repos.upsertWorkspace({ key: "t", name: "T", rootPath: workspaceRoot })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Blocked Prompt", description: "smoke" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: `blocked-prompt-${item.id.toLowerCase()}`,
  })
  const ctx = { workspaceId: run.workspace_fs_id!, workspaceRoot, runId: run.id }
  mkdirSync(layout.runDir(ctx), { recursive: true })
  await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)

  async function blockAt(stageId: string, summary: string, promptId: string, prompt: string): Promise<void> {
    await writeRecoveryRecord(ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "stage", runId: run.id, stageId },
      summary,
      evidencePaths: [],
    })
    repos.setRunRecovery(run.id, {
      status: "blocked",
      scope: "stage",
      scopeRef: stageId,
      summary,
    })
    repos.updateRun(run.id, { status: "blocked", current_stage: stageId })
    repos.createPendingPrompt({ id: promptId, runId: run.id, prompt })
  }

  return {
    repos,
    run,
    db,
    async cleanup() {
      db.close()
    },
    blockAt,
  }
}

test("answerRunPromptInProcess closes an open prompt and resumes the same blocked run once", async () => {
  await withTmpCwd(async () => {
    const fx = await seedBlockedPromptRun()
    try {
      await fx.blockAt("requirements", "Waiting for operator input.", "prompt-1", "Need more detail?")
      const background = createBackgroundHarness()
      const resumedRunIds: string[] = []

      const result = await answerRunPromptInProcess(
        fx.repos,
        { runId: fx.run.id, promptId: "prompt-1", answer: "Focus on audit history.", source: "api" },
        {
          resumeBlockedRunInProcess: true,
          backgroundRunner: background.backgroundRunner,
          resumeRunImpl: async input => {
            resumedRunIds.push(input.runId)
            input.repos.clearRunRecovery(input.runId)
            input.repos.updateRun(input.runId, { status: "running" })
          },
        },
      )
      await background.wait()

      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.promptId, "prompt-1")
      assert.equal(result.conversation.openPrompt, null)
      assert.deepEqual(resumedRunIds, [fx.run.id])
      assert.equal(fx.repos.getPendingPrompt("prompt-1")?.answer, "Focus on audit history.")
      assert.equal(fx.repos.getOpenPrompt(fx.run.id), undefined)
      assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 1)
    } finally {
      await fx.cleanup()
    }
  })
})

test("answerRunPromptInProcess rejects non-open prompts without changing run state", async () => {
  await withTmpCwd(async () => {
    const fx = await seedBlockedPromptRun()
    try {
      await fx.blockAt("requirements", "Waiting for operator input.", "prompt-1", "Need more detail?")
      const background = createBackgroundHarness()
      const resumeAttempts: string[] = []
      const beforeRun = fx.repos.getRun(fx.run.id)
      const beforeLogs = fx.repos.listLogsForRun(fx.run.id).length

      const result = await answerRunPromptInProcess(
        fx.repos,
        { runId: fx.run.id, promptId: "missing-prompt", answer: "ignored", source: "api" },
        {
          resumeBlockedRunInProcess: true,
          backgroundRunner: background.backgroundRunner,
          resumeRunImpl: async input => {
            resumeAttempts.push(input.runId)
          },
        },
      )
      await background.wait()

      assert.deepEqual(result, { ok: false, code: "prompt_not_open" })
      assert.deepEqual(resumeAttempts, [])
      assert.deepEqual(fx.repos.getRun(fx.run.id), beforeRun)
      assert.equal(fx.repos.listLogsForRun(fx.run.id).length, beforeLogs)
      assert.equal(fx.repos.getOpenPrompt(fx.run.id)?.id, "prompt-1")
      assert.equal(fx.repos.getPendingPrompt("prompt-1")?.answered_at, null)
    } finally {
      await fx.cleanup()
    }
  })
})

test("answerRunPromptInProcess allows exactly one concurrent success and one resume", async () => {
  await withTmpCwd(async () => {
    const fx = await seedBlockedPromptRun()
    try {
      await fx.blockAt("requirements", "Waiting for operator input.", "prompt-1", "Need more detail?")
      const background = createBackgroundHarness()
      const resumeAttempts: string[] = []

      const [first, second] = await Promise.all([
        answerRunPromptInProcess(
          fx.repos,
          { runId: fx.run.id, promptId: "prompt-1", answer: "first answer", source: "api" },
          {
            resumeBlockedRunInProcess: true,
            backgroundRunner: background.backgroundRunner,
            resumeRunImpl: async input => {
              resumeAttempts.push(input.runId)
              input.repos.clearRunRecovery(input.runId)
              input.repos.updateRun(input.runId, { status: "running" })
            },
          },
        ),
        answerRunPromptInProcess(
          fx.repos,
          { runId: fx.run.id, promptId: "prompt-1", answer: "second answer", source: "api" },
          {
            resumeBlockedRunInProcess: true,
            backgroundRunner: background.backgroundRunner,
            resumeRunImpl: async input => {
              resumeAttempts.push(input.runId)
              input.repos.clearRunRecovery(input.runId)
              input.repos.updateRun(input.runId, { status: "running" })
            },
          },
        ),
      ])
      await background.wait()

      assert.equal([first, second].filter(result => result.ok).length, 1)
      assert.equal([first, second].filter(result => !result.ok && result.code === "prompt_not_open").length, 1)
      assert.deepEqual(resumeAttempts, [fx.run.id])
      assert.equal(
        fx.repos.listLogsForRun(fx.run.id).filter(log => log.event_type === "prompt_answered").length,
        1,
      )
      assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 1)
    } finally {
      await fx.cleanup()
    }
  })
})

test("answerRunPromptInProcess can re-block on a later prompt and resume again cleanly", async () => {
  await withTmpCwd(async () => {
    const fx = await seedBlockedPromptRun()
    try {
      await fx.blockAt("requirements", "Waiting for operator input.", "prompt-1", "Need more detail?")
      const background = createBackgroundHarness()
      const resumeAttempts: string[] = []
      const resumeRunImpl = async (input: Parameters<NonNullable<Parameters<typeof answerRunPromptInProcess>[2]["resumeRunImpl"]>>[0]) => {
        resumeAttempts.push(input.runId)
        input.repos.clearRunRecovery(input.runId)
        input.repos.updateRun(input.runId, { status: "running" })
      }

      const first = await answerRunPromptInProcess(
        fx.repos,
        { runId: fx.run.id, promptId: "prompt-1", answer: "First answer", source: "api" },
        { resumeBlockedRunInProcess: true, backgroundRunner: background.backgroundRunner, resumeRunImpl },
      )
      await background.wait()
      assert.equal(first.ok, true)
      assert.equal(fx.repos.getPendingPrompt("prompt-1")?.answer, "First answer")

      await fx.blockAt("architecture", "Need architecture direction.", "prompt-2", "Should this stay monolithic?")

      const second = await answerRunPromptInProcess(
        fx.repos,
        { runId: fx.run.id, promptId: "prompt-2", answer: "Yes, keep one process.", source: "api" },
        { resumeBlockedRunInProcess: true, backgroundRunner: background.backgroundRunner, resumeRunImpl },
      )
      await background.wait()

      assert.equal(second.ok, true)
      assert.deepEqual(resumeAttempts, [fx.run.id, fx.run.id])
      assert.equal(fx.repos.getPendingPrompt("prompt-1")?.answer, "First answer")
      assert.equal(fx.repos.getPendingPrompt("prompt-2")?.answer, "Yes, keep one process.")
      assert.equal(fx.repos.getOpenPrompt(fx.run.id), undefined)
      assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 2)
    } finally {
      await fx.cleanup()
    }
  })
})

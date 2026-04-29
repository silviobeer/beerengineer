import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { runWorkflow } from "../src/workflow.ts"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { layout } from "../src/core/workspaceLayout.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { buildWorkflowResumeInput, performResume } from "../src/core/resume.js"
import { preparedImportSourceSnapshotDir } from "../src/core/preparedImport.js"
import { createBus, busToWorkflowIO, type EventBus } from "../src/core/bus.js"
import { defaultAppConfig, writeConfigFile } from "../src/setup/config.js"
import type { StoryImplementationArtifact } from "../src/types.js"
import type { WorkspaceConfigFile } from "../src/types/workspace.js"
import type { RecoveryRecord } from "../src/core/recovery.js"
import type { RunRow } from "../src/db/repositories.js"

function makeWorkflowIO(): { io: WorkflowIO & { bus: EventBus }; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = []
  const brainstormAnswers = [
    "User needs structured workflow.",
    "Target audience: solo-operator teams.",
    "Constraint: single-node, no cloud access.",
    "Yes, constraints are stable enough.",
  ]
  const requirementsAnswers = [
    "Focus: core workflow as input form.",
    "Status badges per entry.",
    "US-02 clearer: filter by status.",
  ]
  let brainstormIdx = 0
  let requirementsIdx = 0
  let phase: "brainstorm" | "requirements" | "qa" | "handoff" = "brainstorm"

  const bus = createBus()
  bus.subscribe(event => events.push(event))

  // Intercept `prompt_requested` and auto-answer via bus.emit(prompt_answered)
  // using the scripted-phase state machine above.
  bus.subscribe(event => {
    if (event.type !== "prompt_requested") return
    let answer: string
    if (event.prompt.startsWith("  Test, merge")) {
      answer = "test"
    } else if (phase === "brainstorm") {
      answer = brainstormAnswers[brainstormIdx++] ?? "ok"
      if (brainstormIdx >= brainstormAnswers.length) phase = "requirements"
    } else if (phase === "requirements") {
      answer = requirementsAnswers[requirementsIdx++] ?? "ok"
      if (requirementsIdx >= requirementsAnswers.length) phase = "qa"
    } else if (phase === "qa") {
      phase = "handoff"
      answer = "accept"
    } else {
      answer = "test"
    }
    bus.emit({ type: "prompt_answered", runId: event.runId, promptId: event.promptId, answer })
  })

  const io = busToWorkflowIO(bus)
  return { events, io }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-resume-"))
  const prev = process.cwd()
  process.chdir(dir)
  const originalLog = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = originalLog
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
}

function sh(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

async function writeWorkspaceConfig(root: string): Promise<void> {
  mkdirSync(join(root, ".beerengineer"), { recursive: true })
  const config: WorkspaceConfigFile = {
    schemaVersion: 2,
    key: "t",
    name: "T",
    rootPath: root,
    harnessProfile: { mode: "fast" },
    runtimePolicy: { mode: "safe-workspace-write" },
    sonarEnabled: false,
    createdAt: Date.now(),
    lastOpenedAt: null,
  }
  await writeFile(join(root, ".beerengineer", "workspace.json"), `${JSON.stringify(config, null, 2)}\n`)
}

test("performResume resumes a blocked story from execution without rerunning prior stages", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    sh(repoRoot, ["init", "--initial-branch=main"])
    sh(repoRoot, ["config", "user.email", "test@example.invalid"])
    sh(repoRoot, ["config", "user.name", "test"])
    await writeFile(join(repoRoot, "README.md"), "seed\n")
    sh(repoRoot, ["add", "-A"])
    sh(repoRoot, ["commit", "-m", "seed"])

    const db = initDatabase(join(process.cwd(), "test.sqlite"))
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "t", name: "T", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, title: "Test Workflow", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `test-workflow-${item.id.toLowerCase()}`,
    })

    try {
      const initial = makeWorkflowIO()
      await runWithWorkflowIO(initial.io, () =>
        runWithActiveRun({ runId: run.id, itemId: item.id }, () =>
          runWorkflow(
            { id: item.id, title: item.title, description: item.description },
            { workspaceRoot: repoRoot },
          ),
        ),
      )
      sh(repoRoot, ["add", "-A"])
      sh(repoRoot, ["commit", "-m", "capture generated docs"])

      const ctx = { workspaceId: `test-workflow-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      // Wave numbering: setup wave at W1 (Fix 4) shifts the original
      // "expansion" feature wave to W3. US-02 now lives in W3 alongside
      // US-03; W2 covers the single-story core wave (US-01).
      const implementationPath = join(layout.executionRalphDir(ctx, 3, "US-02"), "implementation.json")
      const implementation = JSON.parse(await readFile(implementationPath, "utf8")) as StoryImplementationArtifact
      implementation.status = "blocked"
      implementation.finalSummary = "Blocked pending external remediation."
      await writeFile(implementationPath, `${JSON.stringify(implementation, null, 2)}\n`)

      const blockedStoryBranch = `story/test-workflow__p01__w3__us-02`
      await writeRecoveryRecord(ctx, {
        status: "blocked",
        cause: "review_block",
        scope: { type: "story", runId: run.id, waveNumber: 3, storyId: "US-02" },
        summary: "Blocked pending external remediation.",
        branch: blockedStoryBranch,
        evidencePaths: [implementationPath],
      })
      repos.setRunRecovery(run.id, {
        status: "blocked",
        scope: "story",
        scopeRef: "3/US-02",
        summary: "Blocked pending external remediation.",
      })

      const remediation = repos.createExternalRemediation({
        runId: run.id,
        scope: "story",
        scopeRef: "3/US-02",
        summary: "Patched the story branch to address the blocked review findings.",
        branch: blockedStoryBranch,
        source: "api",
      })

      const requests: Array<{ url: string; body: string }> = []
      const server = createServer((req, res) => {
        let body = ""
        req.on("data", chunk => {
          body += chunk.toString()
        })
        req.on("end", () => {
          requests.push({ url: req.url ?? "", body })
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        })
      })
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
      const address = server.address()
      assert.ok(address && typeof address === "object")

      const configPath = join(process.cwd(), "config.json")
      writeConfigFile(configPath, {
        ...defaultAppConfig(),
        publicBaseUrl: "http://100.64.0.7:3100",
        notifications: {
          telegram: {
            enabled: true,
            botTokenEnv: "TELEGRAM_BOT_TOKEN",
            defaultChatId: "123456",
          },
        },
      })
      const prevConfigPath = process.env.BEERENGINEER_CONFIG_PATH
      const prevToken = process.env.TELEGRAM_BOT_TOKEN
      const prevApiBase = process.env.BEERENGINEER_TELEGRAM_API_BASE_URL
      process.env.BEERENGINEER_CONFIG_PATH = configPath
      process.env.TELEGRAM_BOT_TOKEN = "resume-secret-token"
      process.env.BEERENGINEER_TELEGRAM_API_BASE_URL = `http://127.0.0.1:${address.port}`

      const resumed = makeWorkflowIO()
      try {
        await performResume({ repos, io: resumed.io, runId: run.id, remediation })
        for (let i = 0; i < 100; i++) {
          if (repos.getNotificationDelivery(`${run.id}:run_finished`)?.status === "delivered") break
          await new Promise(resolve => setTimeout(resolve, 20))
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
        if (prevConfigPath === undefined) delete process.env.BEERENGINEER_CONFIG_PATH
        else process.env.BEERENGINEER_CONFIG_PATH = prevConfigPath
        if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
        else process.env.TELEGRAM_BOT_TOKEN = prevToken
        if (prevApiBase === undefined) delete process.env.BEERENGINEER_TELEGRAM_API_BASE_URL
        else process.env.BEERENGINEER_TELEGRAM_API_BASE_URL = prevApiBase
      }

      const resumedStages = resumed.events
        .filter((event): event is Extract<WorkflowEvent, { type: "stage_started" }> => event.type === "stage_started")
        .map(event => event.stageKey)
      assert.deepEqual(resumedStages, ["execution", "project-review", "qa", "documentation", "handoff", "merge-gate"])
      assert.equal(repos.getRun(run.id)?.recovery_status, null)
      assert.ok(requests.length > 0, "resume should emit Telegram notifications")
      assert.equal(repos.getNotificationDelivery(`${run.id}:run_finished`)?.status, "delivered")
    } finally {
      db.close()
    }
  })
})

test("buildWorkflowResumeInput trusts recovery scope and preserves prepared-import skipDesignPrep", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    const ctx = {
      workspaceId: "prepared-import-item",
      workspaceRoot: repoRoot,
      runId: "run-1",
    }
    mkdirSync(preparedImportSourceSnapshotDir(ctx), { recursive: true })

    const run = {
      id: "run-1",
      workspace_id: "workspace-1",
      item_id: "item-1",
      title: "Prepared Import",
      status: "blocked",
      current_stage: "visual-companion",
      owner: "cli",
      recovery_status: "blocked",
      recovery_scope: "stage",
      recovery_scope_ref: "execution",
      recovery_summary: "Execution blocked.",
      workspace_fs_id: "prepared-import-item",
      created_at: Date.now(),
      updated_at: Date.now(),
    } satisfies RunRow
    const record = {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "stage", runId: run.id, stageId: "execution" },
      summary: "Execution blocked.",
      evidencePaths: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies RecoveryRecord

    assert.deepEqual(buildWorkflowResumeInput(run, record, ctx), {
      scope: record.scope,
      currentStage: "execution",
      skipDesignPrep: true,
    })
  })
})

test("performResume preserves workspaceRoot so resume stays in real git mode", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    sh(repoRoot, ["init", "--initial-branch=main"])
    sh(repoRoot, ["config", "user.email", "test@example.invalid"])
    sh(repoRoot, ["config", "user.name", "test"])
    await writeFile(join(repoRoot, "README.md"), "seed\n")
    sh(repoRoot, ["add", "README.md"])
    sh(repoRoot, ["commit", "-m", "seed"])
    await writeWorkspaceConfig(repoRoot)
    sh(repoRoot, ["add", ".beerengineer/workspace.json"])
    sh(repoRoot, ["commit", "-m", "workspace config"])

    const db = initDatabase(join(process.cwd(), "test.sqlite"))
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "t", name: "T", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, title: "Resume Git Mode", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `resume-git-mode-${item.id.toLowerCase()}`,
    })

    try {
      const ctx = { workspaceId: `resume-git-mode-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      mkdirSync(layout.runDir(ctx), { recursive: true })
      await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
      await writeRecoveryRecord(ctx, {
        status: "failed",
        cause: "system_error",
        scope: { type: "run", runId: run.id },
        summary: "Resume after external remediation.",
        evidencePaths: [],
      })
      repos.setRunRecovery(run.id, {
        status: "failed",
        scope: "run",
        scopeRef: null,
        summary: "Resume after external remediation.",
      })
      repos.updateRun(run.id, { current_stage: "documentation" })

      const remediation = repos.createExternalRemediation({
        runId: run.id,
        scope: "run",
        scopeRef: null,
        summary: "Workspace has been cleaned and the item branch restored.",
        branch: "item/resume-git-mode",
        source: "api",
      })

      const resumed = makeWorkflowIO()
      await assert.rejects(
        performResume({ repos, io: resumed.io, runId: run.id, remediation }),
        /ENOENT|no such file or directory/,
      )

      const presentationTexts = resumed.events
        .filter((event): event is Extract<typeof resumed.events[number], { type: "presentation" }> => event.type === "presentation")
        .map(event => event.text)
      assert.ok(
        presentationTexts.some(text => text.includes("→ Real git mode: branches will be created in")),
        `expected resume to preserve workspaceRoot and stay in real git mode, got ${JSON.stringify(presentationTexts)}`,
      )
      assert.ok(
        presentationTexts.every(text => !text.includes("Simulated git mode (workspaceRoot not set)")),
        `resume unexpectedly lost workspaceRoot: ${JSON.stringify(presentationTexts)}`,
      )
    } finally {
      db.close()
    }
  })
})

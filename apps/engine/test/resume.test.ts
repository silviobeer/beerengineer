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
import { retryRetainedRunInProcess } from "../src/core/runService.js"
import { layout } from "../src/core/workspaceLayout.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { buildWorkflowResumeInput, loadResumeReadiness, performResume } from "../src/core/resume.js"
import { preparedImportSourceSnapshotDir } from "../src/core/preparedImport.js"
import {
  buildSupabaseProvisioningRecoveryPayload,
  buildSupabaseReadinessRecoveryPayload,
} from "../src/core/supabase/recoveryPayload.js"
import { retainedDiagnosisRecoveryDecision } from "../src/core/supabase/recoveryDecision.js"
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
  let promptCount = 0

  const bus = createBus()
  bus.subscribe(event => events.push(event))

  // Intercept `prompt_requested` and auto-answer via bus.emit(prompt_answered)
  // using prompt text instead of stage-length assumptions. This covers
  // design-prep gates and fails fast if a new interactive prompt is added.
  bus.subscribe(event => {
    if (event.type !== "prompt_requested") return
    promptCount++
    if (promptCount > 80) {
      throw new Error(`Unexpected prompt loop after ${promptCount} prompts; last prompt: ${event.prompt}`)
    }

    let answer: string
    if (event.prompt.startsWith("Promote ")) answer = "promote"
    else if (event.prompt.startsWith("  Test, merge")) answer = "test"
    else if (/wireframes or mockups/i.test(event.prompt)) answer = "none"
    else if (/screens or flows/i.test(event.prompt)) answer = "dashboard first"
    else if (/accessibility, responsive, or interaction constraints/i.test(event.prompt)) answer = "WCAG AA required"
    else if (/^Wireframe summary/i.test(event.prompt)) answer = "approve"
    else if (/design system, brand direction, or reference apps/i.test(event.prompt)) answer = "none"
    else if (/visual tone or product preference/i.test(event.prompt)) answer = "professional"
    else if (/hard constraints on color, typography, density, accessibility, or responsiveness/i.test(event.prompt)) answer = "no brand constraints"
    else if (/^Design summary/i.test(event.prompt)) answer = "approve"
    else if (/^Reviewer findings:/i.test(event.prompt)) answer = "accept"
    else if (/^What problem|^Who is|^What is the core value|^What constraints|^Why are/i.test(event.prompt)) {
      answer = brainstormAnswers[brainstormIdx++] ?? "ok"
    } else if (/^Which feature|^Which action|^Which important boundary/i.test(event.prompt)) {
      answer = requirementsAnswers[requirementsIdx++] ?? "ok"
    } else if (/^Which story or AC should I sharpen/i.test(event.prompt)) {
      answer = requirementsAnswers[requirementsIdx++] ?? "US-02 acceptance criteria"
    } else {
      throw new Error(`Unexpected workflow prompt: ${event.prompt}`)
    }

    bus.emit({ type: "prompt_answered", runId: event.runId, promptId: event.promptId, answer })
  })

  const io = busToWorkflowIO(bus)
  return { events, io }
}

async function withTmpCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "be2-resume-"))
  const prev = process.cwd()
  const previousDbPath = process.env.BEERENGINEER_UI_DB_PATH
  process.chdir(dir)
  process.env.BEERENGINEER_UI_DB_PATH = join(dir, "beerengineer-test.sqlite")
  const originalLog = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = originalLog
    if (previousDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousDbPath
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
    autoPromoteOnGreenQa: true,
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

test("loadResumeReadiness keeps blocked runs with open prompts non-resumable until answered", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    const db = initDatabase(join(process.cwd(), "test.sqlite"))
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "t", name: "T", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Blocked Prompt", description: "smoke" })
    const run = repos.createRun({
      workspaceId: workspace.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `blocked-prompt-${item.id.toLowerCase()}`,
    })

    try {
      const ctx = { workspaceId: `blocked-prompt-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      mkdirSync(layout.runDir(ctx), { recursive: true })
      await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
      await writeRecoveryRecord(ctx, {
        status: "blocked",
        cause: "stage_error",
        scope: { type: "stage", runId: run.id, stageId: "requirements" },
        summary: "Waiting for operator input.",
        evidencePaths: [],
      })
      repos.setRunRecovery(run.id, {
        status: "blocked",
        scope: "stage",
        scopeRef: "requirements",
        summary: "Waiting for operator input.",
      })
      repos.updateRun(run.id, { status: "blocked", current_stage: "requirements" })
      repos.createPendingPrompt({
        id: "p-open",
        runId: run.id,
        prompt: "Need more detail?",
      })

      const readiness = await loadResumeReadiness(repos, run.id)
      assert.deepEqual(readiness, {
        kind: "not_resumable",
        run: repos.getRun(run.id),
        reason: "open_prompt",
      })
    } finally {
      db.close()
    }
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

test("performResume keeps a persisted plan on run-scope provisioning resume when current_stage is null", async () => {
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
    const item = repos.createItem({ workspaceId: ws.id, title: "Provisioning Resume", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `provisioning-resume-${item.id.toLowerCase()}`,
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

      const ctx = { workspaceId: `provisioning-resume-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      const planPath = join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json")
      const planBefore = await readFile(planPath, "utf8")
      const planArtifact = JSON.parse(planBefore) as { plan: { waves: Array<{ id: string; number: number }> } }
      const resumedWave = planArtifact.plan.waves[0]
      assert.ok(resumedWave, "expected a persisted plan wave to exist before resume")

      repos.updateRun(run.id, {
        status: "blocked",
        current_stage: null,
        recovery_status: "blocked",
        recovery_scope: "run",
        recovery_scope_ref: null,
        recovery_summary: "Supabase provisioning failed during branch activation.",
        recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
          runId: run.id,
          workspaceId: ws.id,
          workspaceKey: ws.key,
          projectRef: "proj_test",
          waveId: resumedWave.id,
          waveNumber: resumedWave.number,
          branchRef: "br_saved",
          failedStep: "poll",
          failureCause: "Branch activation timed out",
          userMessage: "Supabase provisioning failed. Operator recovery action is required.",
        }),
      })
      await writeRecoveryRecord(ctx, {
        status: "blocked",
        cause: "stage_error",
        scope: { type: "run", runId: run.id },
        summary: "Supabase provisioning failed during branch activation.",
        detail: "seeded provisioning recovery",
        evidencePaths: [layout.runDir(ctx)],
      })

      const remediation = repos.createExternalRemediation({
        runId: run.id,
        scope: "run",
        scopeRef: null,
        summary: "Operator retried the blocked provisioning run.",
        branch: "item/provisioning-resume",
        source: "api",
      })

      let capturedResume: Awaited<Parameters<typeof runWorkflow>[1]>["resume"] | undefined
      const resumed = makeWorkflowIO()
      await performResume({
        repos,
        io: resumed.io,
        runId: run.id,
        remediation,
        workflowRunner: async (_item, options) => {
          capturedResume = options?.resume
        },
      })

      assert.equal(capturedResume?.scope.type, "run")
      assert.equal(capturedResume?.currentStage, "execution")
      assert.equal(await readFile(planPath, "utf8"), planBefore)
      assert.deepEqual(
        resumed.events.filter(event => event.type === "run_resumed").map(event => event.type),
        ["run_resumed"],
      )
    } finally {
      db.close()
    }
  })
})

test("REQ-2 AC-2.2/AC-2.3: retryRetainedRunInProcess starts recovery on the retained branch without a second resume call", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    const db = initDatabase(join(process.cwd(), "test.sqlite"))
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "t", name: "T", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, title: "Retained Retry", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `retained-retry-${item.id.toLowerCase()}`,
    })

    try {
      const ctx = { workspaceId: `retained-retry-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      mkdirSync(layout.runDir(ctx), { recursive: true })
      await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
      repos.setRunSupabaseBranch(run.id, {
        ref: "br_retained",
        name: "wave-1",
        lifecycleState: "retained-for-diagnosis",
      })
      repos.updateRun(run.id, {
        status: "blocked",
        current_stage: "execution",
        recovery_status: "blocked",
        recovery_scope: "run",
        recovery_scope_ref: null,
        recovery_summary: "Supabase provisioning failed during validation.",
        recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
          runId: run.id,
          workspaceId: ws.id,
          workspaceKey: ws.key,
          projectRef: "proj_test",
          waveId: "W1",
          waveNumber: 1,
          branchRef: "br_retained",
          failedStep: "validate",
          failureCause: "Validation failed",
          userMessage: "Supabase provisioning failed. Operator recovery action is required.",
        }),
      })
      await writeRecoveryRecord(ctx, {
        status: "blocked",
        cause: "stage_error",
        scope: { type: "run", runId: run.id },
        summary: "Supabase provisioning failed during validation.",
        detail: "seeded retained diagnosis recovery",
        evidencePaths: [layout.runDir(ctx)],
      })

      const result = await retryRetainedRunInProcess(repos, {
        runId: run.id,
        resumeRunImpl: async input => {
          await performResume({
            ...input,
            workflowRunner: async () => {},
          })
        },
      })

      assert.equal(result.ok, true)
      assert.equal(repos.getRun(run.id)?.status, "queued")
      assert.equal(retainedDiagnosisRecoveryDecision(repos.getRun(run.id)!), null)
      for (let i = 0; i < 50; i++) {
        if (repos.getRun(run.id)?.status === "completed") break
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const resumed = repos.getRun(run.id)
      assert.equal(repos.listExternalRemediations(run.id).length, 1)
      assert.equal(repos.listExternalRemediations(run.id)[0]?.summary, "Operator retried the retained diagnosis branch.")
      assert.equal(repos.listLogsForRun(run.id).some(log => log.event_type === "run_resumed"), true)
      assert.equal(resumed?.status, "completed")
      assert.equal(resumed?.recovery_status, null)
      assert.equal(resumed?.supabase_branch_ref, "br_retained")
      assert.equal(resumed?.supabase_branch_lifecycle_state, "retained-for-diagnosis")
    } finally {
      db.close()
    }
  })
})

test("REQ-2 AC-2.4: retryRetainedRunInProcess returns the authoritative current state when the run is no longer retained for diagnosis", async () => {
  await withTmpCwd(async () => {
    const repoRoot = join(process.cwd(), "repo")
    mkdirSync(repoRoot, { recursive: true })
    const db = initDatabase(join(process.cwd(), "test.sqlite"))
    const repos = new Repos(db)
    const ws = repos.upsertWorkspace({ key: "t", name: "T", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: ws.id, title: "Retained Retry Conflict", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `retained-retry-conflict-${item.id.toLowerCase()}`,
    })

    try {
      const ctx = { workspaceId: `retained-retry-conflict-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      mkdirSync(layout.runDir(ctx), { recursive: true })
      await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
      repos.updateRun(run.id, {
        status: "failed",
        current_stage: "execution",
        recovery_status: "failed",
        recovery_scope: "run",
        recovery_scope_ref: null,
        recovery_summary: "Run has already moved on.",
      })
      await writeRecoveryRecord(ctx, {
        status: "failed",
        cause: "stage_error",
        scope: { type: "run", runId: run.id },
        summary: "Run has already moved on.",
        detail: "seeded stale retained retry conflict",
        evidencePaths: [layout.runDir(ctx)],
      })

      const result = await retryRetainedRunInProcess(repos, { runId: run.id })

      assert.deepEqual(result, {
        ok: false,
        status: 409,
        error: "retry_retained_conflict",
        code: "retry_retained_conflict",
        message: "retry-retained is only available while the run is retained for diagnosis.",
        currentState: {
          status: "failed",
          recoveryStatus: "failed",
          supabaseBranchLifecycleState: null,
        },
      })
      assert.equal(repos.listExternalRemediations(run.id).length, 0)
      assert.equal(repos.listLogsForRun(run.id).some(log => log.event_type === "run_resumed"), false)
    } finally {
      db.close()
    }
  })
})

test("performResume keeps the same persisted plan across repeated run-scope resumes from planning-stage recovery", async () => {
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
    const item = repos.createItem({ workspaceId: ws.id, title: "Repeated Resume", description: "smoke" })
    const run = repos.createRun({
      workspaceId: ws.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: `repeated-resume-${item.id.toLowerCase()}`,
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

      const ctx = { workspaceId: `repeated-resume-${item.id.toLowerCase()}`, workspaceRoot: repoRoot, runId: run.id }
      const planPath = join(layout.stageArtifactsDir(ctx, "planning"), "implementation-plan.json")
      const planBefore = await readFile(planPath, "utf8")

      const reblockRun = async (summary: string) => {
        repos.updateRun(run.id, {
          status: "blocked",
          current_stage: "planning",
          recovery_status: "blocked",
          recovery_scope: "run",
          recovery_scope_ref: null,
          recovery_summary: summary,
          recovery_payload_json: buildSupabaseReadinessRecoveryPayload({
            status: "blocked",
            missingSetupActions: ["Create persistent test branch"],
            retry: { available: true, runId: run.id },
            workspace: { id: ws.id, key: ws.key, rootPath: repoRoot, projectRef: "proj_test" },
            dbRelevanceTrigger: { waveId: "W1", waveNumber: 1, storyId: "US-1" },
            message: summary,
          }),
        })
        await writeRecoveryRecord(ctx, {
          status: "blocked",
          cause: "stage_error",
          scope: { type: "run", runId: run.id },
          summary,
          detail: "seeded repeated readiness recovery",
          evidencePaths: [layout.runDir(ctx)],
        })
      }

      await reblockRun("Supabase readiness blocked planned DB-relevant work.")

      const capturedStages: Array<string | null | undefined> = []
      const resumed = makeWorkflowIO()
      const workflowRunner = async (_item: Parameters<typeof runWorkflow>[0], options?: Parameters<typeof runWorkflow>[1]) => {
        capturedStages.push(options?.resume?.currentStage)
        await reblockRun("Supabase readiness blocked planned DB-relevant work again.")
      }

      const firstRemediation = repos.createExternalRemediation({
        runId: run.id,
        scope: "run",
        scopeRef: null,
        summary: "Operator retried the blocked readiness run.",
        branch: "item/repeated-resume",
        source: "api",
      })
      await performResume({
        repos,
        io: resumed.io,
        runId: run.id,
        remediation: firstRemediation,
        workflowRunner,
      })

      const secondRemediation = repos.createExternalRemediation({
        runId: run.id,
        scope: "run",
        scopeRef: null,
        summary: "Operator retried the blocked readiness run again.",
        branch: "item/repeated-resume",
        source: "api",
      })
      await performResume({
        repos,
        io: resumed.io,
        runId: run.id,
        remediation: secondRemediation,
        workflowRunner,
      })

      assert.deepEqual(capturedStages, ["execution", "execution"])
      assert.equal(await readFile(planPath, "utf8"), planBefore)
      assert.deepEqual(
        resumed.events.filter(event => event.type === "run_resumed").map(event => event.type),
        ["run_resumed", "run_resumed"],
      )
    } finally {
      db.close()
    }
  })
})

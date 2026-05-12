import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { buildSupabaseProvisioningRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"
const TEST_API_WORKER_INSTANCE_ID = "test-api-worker"
const CLEAR_ACTION_CASES = [
  { action: "clear_recovery_payload", targetKey: "recovery_payload_json" },
  { action: "clear_supabase_branch_ref", targetKey: "supabase_branch_ref" },
  { action: "clear_supabase_branch_lifecycle_state", targetKey: "supabase_branch_lifecycle_state" },
] as const

type ClearAction = (typeof CLEAR_ACTION_CASES)[number]["action"]
type ObservableRunState = {
  status: string
  current_stage: string | null
  recovery_status: string | null
  recovery_payload_json: string | null
  supabase_branch_ref: string | null
  supabase_branch_lifecycle_state: string | null
  stageRuns: Array<Record<string, unknown>>
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const probe = createNetServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("failed to allocate an ephemeral test port")))
        return
      }
      const { port } = address
      probe.close(error => {
        if (error) reject(error)
        else resolvePromise(port)
      })
    })
  })
}

async function waitForHealth(base: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

async function startEngineServer(env: NodeJS.ProcessEnv): Promise<{ proc: ChildProcess; base: string; port: number }> {
  const port = await findFreePort()
  const host = "127.0.0.1"
  const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      HOST: host,
      PORT: String(port),
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout.on("data", () => {})
  proc.stderr.on("data", () => {})
  return { proc, base: `http://${host}:${port}`, port }
}

function stopEngineServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolvePromise => {
    if (proc.exitCode !== null) return resolvePromise()
    proc.once("exit", () => resolvePromise())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function createRunFixture(repos: Repos, input: { title: string; recoverySummary: string }) {
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
  const item = repos.createItem({ workspaceId: workspace.id, title: input.title, description: input.title })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api", status: "blocked" })
  repos.updateRun(run.id, {
    status: "blocked",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: input.recoverySummary,
  })
  return { workspace, run }
}

function createFreshRecoveryRun(repos: Repos, label: string): string {
  const fresh = createRunFixture(repos, {
    title: `Fresh path ${label}`,
    recoverySummary: "Supabase provisioning needs a fresh branch recovery path.",
  })
  repos.setRunRecoveryPayloadJson(fresh.run.id, buildSupabaseProvisioningRecoveryPayload({
    runId: fresh.run.id,
    workspaceId: fresh.workspace.id,
    workspaceKey: fresh.workspace.key,
    projectRef: "proj_alpha",
    waveId: "W1",
    waveNumber: 1,
    failedStep: "validate",
    failureCause: "Validation failed before any retained branch was selected.",
    userMessage: "Operator recovery is required.",
  }))
  repos.setRunRecoverySupabaseLifecycleState(fresh.run.id, "provisioning")
  return fresh.run.id
}

function createRetainedRecoveryRun(repos: Repos, label: string): string {
  const retained = createRunFixture(repos, {
    title: `Retained path ${label}`,
    recoverySummary: "Supabase provisioning retained the branch for diagnosis.",
  })
  repos.setRunSupabaseBranch(retained.run.id, {
    ref: "br_retained",
    name: `alpha-retained-${label}`,
    lifecycleState: "retained-for-diagnosis",
  })
  repos.setRunRecoveryPayloadJson(retained.run.id, buildSupabaseProvisioningRecoveryPayload({
    runId: retained.run.id,
    workspaceId: retained.workspace.id,
    workspaceKey: retained.workspace.key,
    projectRef: "proj_alpha",
    waveId: "W1",
    waveNumber: 1,
    branchRef: "br_retained",
    failedStep: "validate",
    failureCause: "Validation failed after branch retention.",
    userMessage: "Operator recovery is required.",
  }))
  return retained.run.id
}

function createSkipEligibleRun(repos: Repos, label: string): string {
  const run = createRunFixture(repos, {
    title: `Skip eligible ${label}`,
    recoverySummary: "Eligible for skip-current-stage.",
  })
  const staleStartedAt = Date.now() - 300_000
  repos.updateRun(run.run.id, {
    status: "running",
    current_stage: "execution",
    recovery_status: null,
    recovery_scope: null,
    recovery_scope_ref: null,
    recovery_summary: null,
    recovery_payload_json: null,
  })
  repos.claimRunWorkerLease(run.run.id, {
    workerInstanceId: TEST_API_WORKER_INSTANCE_ID,
    workerOwnerKind: "api",
    startedAt: staleStartedAt,
    heartbeatAt: staleStartedAt,
  })
  repos.createStageRun({ runId: run.run.id, stageKey: "execution" })
  return run.run.id
}

function createSkipInactiveRun(repos: Repos, label: string): string {
  const run = createRunFixture(repos, {
    title: `Skip inactive ${label}`,
    recoverySummary: "Current stage is no longer active.",
  })
  repos.updateRun(run.run.id, {
    status: "blocked",
    current_stage: "planning",
    recovery_status: "blocked",
    recovery_scope: "stage",
    recovery_scope_ref: "planning",
    recovery_summary: "Manual review is required before continuing.",
    recovery_payload_json: null,
  })
  repos.createStageRun({ runId: run.run.id, stageKey: "planning" })
  return run.run.id
}

function createClearRun(repos: Repos, action: ClearAction, label: string, alreadyClear: boolean): string {
  const run = createRunFixture(repos, {
    title: `${action} ${label}`,
    recoverySummary: `${action} fixture`,
  })
  repos.setRunRecoveryPayloadJson(run.run.id, JSON.stringify({ fixture: action, value: "payload" }))
  repos.setRunRecoverySupabaseBranchRef(run.run.id, `br_${action}`)
  repos.setRunRecoverySupabaseLifecycleState(run.run.id, `lifecycle_${action}`)
  if (alreadyClear) {
    const target = CLEAR_ACTION_CASES.find(candidate => candidate.action === action)?.targetKey
    if (target === "recovery_payload_json") repos.setRunRecoveryPayloadJson(run.run.id, null)
    if (target === "supabase_branch_ref") repos.setRunRecoverySupabaseBranchRef(run.run.id, null)
    if (target === "supabase_branch_lifecycle_state") repos.setRunRecoverySupabaseLifecycleState(run.run.id, null)
  }
  return run.run.id
}

function seedParityFixtures(dbPath: string) {
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  try {
    const accepted = {
      recover_fresh_branch: { apiRunId: createFreshRecoveryRun(repos, "api"), cliRunId: createFreshRecoveryRun(repos, "cli") },
      retry_retained: { apiRunId: createRetainedRecoveryRun(repos, "api"), cliRunId: createRetainedRecoveryRun(repos, "cli") },
      clear_and_fresh: { apiRunId: createRetainedRecoveryRun(repos, "api-clear"), cliRunId: createRetainedRecoveryRun(repos, "cli-clear") },
      skip_current_stage: { apiRunId: createSkipEligibleRun(repos, "api"), cliRunId: createSkipEligibleRun(repos, "cli") },
    }
    const noop = Object.fromEntries(
      CLEAR_ACTION_CASES.map(testCase => [
        testCase.action,
        {
          apiRunId: createClearRun(repos, testCase.action, "api-noop", true),
          cliRunId: createClearRun(repos, testCase.action, "cli-noop", true),
        },
      ]),
    ) as Record<ClearAction, { apiRunId: string; cliRunId: string }>
    const clearAccepted = Object.fromEntries(
      CLEAR_ACTION_CASES.map(testCase => [
        testCase.action,
        {
          apiRunId: createClearRun(repos, testCase.action, "api-populated", false),
          cliRunId: createClearRun(repos, testCase.action, "cli-populated", false),
        },
      ]),
    ) as Record<ClearAction, { apiRunId: string; cliRunId: string }>
    const rejected = {
      recover_fresh_branch: { apiRunId: createRetainedRecoveryRun(repos, "api-reject"), cliRunId: createRetainedRecoveryRun(repos, "cli-reject") },
      retry_retained: { apiRunId: createFreshRecoveryRun(repos, "api-reject"), cliRunId: createFreshRecoveryRun(repos, "cli-reject") },
      skip_current_stage: { apiRunId: createSkipInactiveRun(repos, "api-reject"), cliRunId: createSkipInactiveRun(repos, "cli-reject") },
    }
    return { accepted, noop, clearAccepted, rejected }
  } finally {
    db.close()
  }
}

function writeCliConfig(configPath: string, dataDir: string, port: number): void {
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir,
    allowedRoots: ["/tmp"],
    enginePort: port,
    publicBaseUrl: "http://127.0.0.1:3100",
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }), "utf8")
}

async function postRecovery(base: string, runId: string, action: string): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}/runs/${runId}/recovery`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-beerengineer-token": TEST_API_TOKEN,
    },
    body: JSON.stringify({ action }),
  })
  return { status: response.status, json: await response.json() }
}

async function getObservableRunState(base: string, runId: string): Promise<ObservableRunState> {
  const runResponse = await fetch(`${base}/runs/${runId}`)
  const runBody = await runResponse.json() as Omit<ObservableRunState, "stageRuns">
  const treeResponse = await fetch(`${base}/runs/${runId}/tree`)
  const treeBody = await treeResponse.json() as { stageRuns: Array<{ stage_key: string; status: string }> }
  return {
    status: runBody.status,
    current_stage: runBody.current_stage,
    recovery_status: runBody.recovery_status,
    recovery_payload_json: runBody.recovery_payload_json,
    supabase_branch_ref: runBody.supabase_branch_ref,
    supabase_branch_lifecycle_state: runBody.supabase_branch_lifecycle_state,
    stageRuns: treeBody.stageRuns,
  }
}

function normalizeObservableRunState(state: ObservableRunState): ObservableRunState {
  let recoveryPayloadJson = state.recovery_payload_json
  if (recoveryPayloadJson) {
    try {
      const parsed = JSON.parse(recoveryPayloadJson) as Record<string, unknown>
      delete parsed.runId
      recoveryPayloadJson = JSON.stringify(parsed)
    } catch {
      recoveryPayloadJson = state.recovery_payload_json
    }
  }
  return {
    ...state,
    recovery_payload_json: recoveryPayloadJson,
    stageRuns: state.stageRuns.map(stageRun => ({
      stage_key: stageRun.stage_key,
      status: stageRun.status,
    })),
  }
}

function runCliRecoveryCommand(input: {
  binPath: string
  engineRoot: string
  configPath: string
  dbPath: string
  port: number
  runId: string
  action: string
}) {
  return spawnSync(
    process.execPath,
    [input.binPath, "run", "recovery", input.runId, input.action],
    {
      cwd: input.engineRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        BEERENGINEER_CONFIG_PATH: input.configPath,
        BEERENGINEER_UI_DB_PATH: input.dbPath,
        BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
        BEERENGINEER_ENGINE_PORT: String(input.port),
      },
      timeout: 10000,
    },
  )
}

test("REQ-4 TC-REQ-4-02/07/08 canonical recovery CLI wrappers preserve API outcome and resulting state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-recovery-parity-"))
  const dbPath = join(dir, "workflow.sqlite")
  const configPath = join(dir, "config.json")
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const server = await startEngineServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    writeCliConfig(configPath, dir, server.port)
    await waitForHealth(server.base)
    const fixture = seedParityFixtures(dbPath)

    for (const action of ["recover_fresh_branch", "retry_retained", "clear_and_fresh", "skip_current_stage"] as const) {
      const pair = fixture.accepted[action]
      const api = await postRecovery(server.base, pair.apiRunId, action)
      const cli = runCliRecoveryCommand({
        binPath,
        engineRoot,
        configPath,
        dbPath,
        port: server.port,
        runId: pair.cliRunId,
        action,
      })

      assert.equal(api.status, 200)
      assert.equal(cli.status, 0, `${cli.stdout ?? ""}\n${cli.stderr ?? ""}`)
      assert.match(cli.stdout ?? "", new RegExp(`action: ${action}`))
      assert.match(cli.stdout ?? "", /outcome: accepted/)

      const apiState = normalizeObservableRunState(await getObservableRunState(server.base, pair.apiRunId))
      const cliState = normalizeObservableRunState(await getObservableRunState(server.base, pair.cliRunId))
      assert.deepEqual(cliState, apiState)
    }

    for (const testCase of CLEAR_ACTION_CASES) {
      const pair = fixture.clearAccepted[testCase.action]
      const api = await postRecovery(server.base, pair.apiRunId, testCase.action)
      const cli = runCliRecoveryCommand({
        binPath,
        engineRoot,
        configPath,
        dbPath,
        port: server.port,
        runId: pair.cliRunId,
        action: testCase.action,
      })

      assert.equal(api.status, 200)
      assert.equal(cli.status, 0, `${cli.stdout ?? ""}\n${cli.stderr ?? ""}`)
      assert.match(cli.stdout ?? "", new RegExp(`action: ${testCase.action}`))
      assert.match(cli.stdout ?? "", /outcome: accepted/)

      const apiState = normalizeObservableRunState(await getObservableRunState(server.base, pair.apiRunId))
      const cliState = normalizeObservableRunState(await getObservableRunState(server.base, pair.cliRunId))
      assert.deepEqual(cliState, apiState)
    }

    for (const testCase of CLEAR_ACTION_CASES) {
      const pair = fixture.noop[testCase.action]
      const api = await postRecovery(server.base, pair.apiRunId, testCase.action)
      const cli = runCliRecoveryCommand({
        binPath,
        engineRoot,
        configPath,
        dbPath,
        port: server.port,
        runId: pair.cliRunId,
        action: testCase.action,
      })

      assert.equal(api.status, 200)
      assert.equal(cli.status, 0, `${cli.stdout ?? ""}\n${cli.stderr ?? ""}`)
      assert.match(cli.stdout ?? "", new RegExp(`action: ${testCase.action}`))
      assert.match(cli.stdout ?? "", /outcome: noop/)
      assert.match(cli.stdout ?? "", /reason: already_clear/)

      const apiState = normalizeObservableRunState(await getObservableRunState(server.base, pair.apiRunId))
      const cliState = normalizeObservableRunState(await getObservableRunState(server.base, pair.cliRunId))
      assert.deepEqual(cliState, apiState)
    }
  } finally {
    await stopEngineServer(server.proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-4 TC-REQ-4-03/06 canonical recovery CLI rejections preserve API reason and keep state unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-recovery-reject-"))
  const dbPath = join(dir, "workflow.sqlite")
  const configPath = join(dir, "config.json")
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const server = await startEngineServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    writeCliConfig(configPath, dir, server.port)
    await waitForHealth(server.base)
    const fixture = seedParityFixtures(dbPath)

    const cases = [
      { action: "recover_fresh_branch", reason: "incompatible_recovery_state" },
      { action: "retry_retained", reason: "incompatible_recovery_state" },
      { action: "skip_current_stage", reason: "current_stage_not_active" },
    ] as const

    for (const testCase of cases) {
      const pair = fixture.rejected[testCase.action]
      const apiBefore = normalizeObservableRunState(await getObservableRunState(server.base, pair.apiRunId))
      const cliBefore = normalizeObservableRunState(await getObservableRunState(server.base, pair.cliRunId))

      const api = await postRecovery(server.base, pair.apiRunId, testCase.action)
      const cli = runCliRecoveryCommand({
        binPath,
        engineRoot,
        configPath,
        dbPath,
        port: server.port,
        runId: pair.cliRunId,
        action: testCase.action,
      })

      assert.equal(api.status, 409)
      assert.equal(cli.status, 75, `${cli.stdout ?? ""}\n${cli.stderr ?? ""}`)
      assert.match(cli.stderr ?? "", new RegExp(`action: ${testCase.action}`))
      assert.match(cli.stderr ?? "", new RegExp(`reason: ${testCase.reason}`))
      assert.match(cli.stderr ?? "", new RegExp(String(api.json.message).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

      const apiAfter = normalizeObservableRunState(await getObservableRunState(server.base, pair.apiRunId))
      const cliAfter = normalizeObservableRunState(await getObservableRunState(server.base, pair.cliRunId))
      assert.deepEqual(apiAfter, apiBefore)
      assert.deepEqual(cliAfter, cliBefore)
      assert.deepEqual(cliAfter, apiAfter)
    }
  } finally {
    await stopEngineServer(server.proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

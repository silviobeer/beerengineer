import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../src/setup/secretMetadata.js"
import { storeSecret } from "../src/setup/secretStore.js"
import { removeTempDir } from "./helpers/fs.js"

const TEST_API_TOKEN = "test-token"

type StartedServer = {
  proc: ChildProcess
  base: string
  stdout: string[]
  stderr: string[]
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function startServer(env: NodeJS.ProcessEnv): StartedServer {
  const port = 4700 + Math.floor(Math.random() * 200)
  const host = "127.0.0.1"
  const stdout: string[] = []
  const stderr: string[] = []
  const proc = spawn(process.execPath, ["--import", "tsx", "src/api/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout?.on("data", chunk => stdout.push(String(chunk)))
  proc.stderr?.on("data", chunk => stderr.push(String(chunk)))
  return { proc, base: `http://${host}:${port}`, stdout, stderr }
}

async function stopServer(proc: ChildProcess): Promise<void> {
  await new Promise<void>(resolveStop => {
    if (proc.exitCode !== null) return resolveStop()
    proc.once("exit", () => resolveStop())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function seedConfiguredWorkspace(repos: Repos, key = "alpha"): void {
  const workspace = repos.upsertWorkspace({ key, name: key.toUpperCase() })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: `proj_${key}`, region: "eu-central-1" })
  repos.setWorkspaceSupabasePersistentBranch(workspace.id, {
    ref: `br_${key}`,
    name: `branch-${key}`,
    status: "ACTIVE_HEALTHY",
  })
}

async function createRun(base: string, workspaceKey: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/runs`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      title: "Capability safety",
      description: "reviewer-visible evidence",
      workspaceKey,
    }),
  })
  return {
    status: res.status,
    text: await res.text(),
  }
}

function assertNoLeaks(haystack: string, values: string[]): void {
  for (const value of values) {
    assert.equal(haystack.includes(value), false, `expected output to omit ${value}`)
  }
}

test("PROJ-8-PRD-3-US-5 TC-1 TC-7: successful configured starts keep API and process output secret-free", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-capability-safety-success-"))
  const dbPath = join(dir, "engine.sqlite")
  const storePath = join(dir, "secret-store", "secrets.json")
  const managementToken = "sbp_success_secret_123"
  const secretLikePath = storePath

  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  seedConfiguredWorkspace(repos)
  db.close()
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, managementToken, { storePath })

  const server = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_SECRET_STORE_PATH: storePath,
  })

  try {
    await waitForHealth(server.base)
    const result = await createRun(server.base, "alpha")
    assert.equal(result.status, 202)
    assertNoLeaks(result.text, [managementToken, secretLikePath])
    assertNoLeaks(server.stdout.join(""), [managementToken, secretLikePath])
    assertNoLeaks(server.stderr.join(""), [managementToken, secretLikePath])
  } finally {
    await stopServer(server.proc)
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-5 TC-2 TC-3 TC-5 TC-8: blocked-readiness failures redact secrets but stay diagnosable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-capability-safety-readiness-"))
  const dbPath = join(dir, "engine.sqlite")
  const secretFilePath = join(dir, "fixtures", "supabase-service-role.env")
  const serviceRoleKey = "sb_service_role_secret_123"
  const managementToken = "sbp_failure_secret_123"

  mkdirSync(join(dir, "fixtures"), { recursive: true })
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  seedConfiguredWorkspace(repos)
  db.close()

  const server = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_TEST_WORKFLOW_CAPABILITY_FAILURE: JSON.stringify({
      status: 503,
      reason: "blocked_readiness",
      message: `Supabase readiness is blocked until project access is restored for ${managementToken} using ${serviceRoleKey} from ${secretFilePath}.`,
      secrets: [managementToken, serviceRoleKey, secretFilePath],
      detail: { nested: `provider detail ${serviceRoleKey}` },
    }),
  })

  try {
    await waitForHealth(server.base)
    const result = await createRun(server.base, "alpha")
    assert.equal(result.status, 503)
    assert.match(result.text, /Supabase readiness is blocked until project access is restored/i)
    assert.match(result.text, /workflow_capability_blocked/)
    assert.match(result.text, /blocked_readiness/)
    assertNoLeaks(result.text, [managementToken, serviceRoleKey, secretFilePath])
    assertNoLeaks(server.stdout.join(""), [managementToken, serviceRoleKey, secretFilePath])
    assertNoLeaks(server.stderr.join(""), [managementToken, serviceRoleKey, secretFilePath])
  } finally {
    await stopServer(server.proc)
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-5 TC-4: gate-blocked failures stay diagnosable after redaction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-capability-safety-gate-"))
  const dbPath = join(dir, "engine.sqlite")
  const secretFilePath = join(dir, "fixtures", "production-gate.env")
  const serviceRoleKey = "sb_service_role_gate_secret_456"

  mkdirSync(join(dir, "fixtures"), { recursive: true })
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  seedConfiguredWorkspace(repos)
  db.close()

  const server = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_TEST_WORKFLOW_CAPABILITY_FAILURE: JSON.stringify({
      status: 409,
      reason: "gate_blocked",
      message: `Production migration safety gate blocked capability use for ${serviceRoleKey} in ${secretFilePath}.`,
      secrets: [serviceRoleKey, secretFilePath],
    }),
  })

  try {
    await waitForHealth(server.base)
    const result = await createRun(server.base, "alpha")
    assert.equal(result.status, 409)
    assert.match(result.text, /Production migration safety gate blocked capability use/i)
    assert.match(result.text, /gate_blocked/)
    assertNoLeaks(result.text, [serviceRoleKey, secretFilePath])
  } finally {
    await stopServer(server.proc)
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-5 TC-6: capability failure modes remain distinct to operators and reviewers", async () => {
  const incompleteDir = mkdtempSync(join(tmpdir(), "be2-capability-safety-incomplete-"))
  const incompleteDbPath = join(incompleteDir, "engine.sqlite")
  const incompleteDb = initDatabase(incompleteDbPath)
  const incompleteRepos = new Repos(incompleteDb)
  const incompleteWorkspace = incompleteRepos.upsertWorkspace({ key: "alpha", name: "ALPHA" })
  incompleteRepos.connectWorkspaceSupabase(incompleteWorkspace.id, { projectRef: "proj_alpha", region: "eu-central-1" })
  incompleteDb.close()

  const incomplete = startServer({ BEERENGINEER_UI_DB_PATH: incompleteDbPath })
  try {
    await waitForHealth(incomplete.base)
    const result = await createRun(incomplete.base, "alpha")
    assert.equal(result.status, 400)
    assert.match(result.text, /configured but incomplete/i)
  } finally {
    await stopServer(incomplete.proc)
    removeTempDir(incompleteDir)
  }

  const readinessDir = mkdtempSync(join(tmpdir(), "be2-capability-safety-distinct-readiness-"))
  const readinessDbPath = join(readinessDir, "engine.sqlite")
  const readinessDb = initDatabase(readinessDbPath)
  const readinessRepos = new Repos(readinessDb)
  seedConfiguredWorkspace(readinessRepos)
  readinessDb.close()

  const readiness = startServer({
    BEERENGINEER_UI_DB_PATH: readinessDbPath,
    BEERENGINEER_TEST_WORKFLOW_CAPABILITY_FAILURE: JSON.stringify({
      status: 503,
      reason: "blocked_readiness",
      message: "Supabase readiness is blocked until setup is rechecked.",
    }),
  })
  try {
    await waitForHealth(readiness.base)
    const result = await createRun(readiness.base, "alpha")
    assert.equal(result.status, 503)
    assert.match(result.text, /readiness is blocked/i)
  } finally {
    await stopServer(readiness.proc)
    removeTempDir(readinessDir)
  }

  const gateDir = mkdtempSync(join(tmpdir(), "be2-capability-safety-distinct-gate-"))
  const gateDbPath = join(gateDir, "engine.sqlite")
  const gateDb = initDatabase(gateDbPath)
  const gateRepos = new Repos(gateDb)
  seedConfiguredWorkspace(gateRepos)
  gateDb.close()

  const gate = startServer({
    BEERENGINEER_UI_DB_PATH: gateDbPath,
    BEERENGINEER_TEST_WORKFLOW_CAPABILITY_FAILURE: JSON.stringify({
      status: 409,
      reason: "gate_blocked",
      message: "Production migration safety gate blocked capability use.",
    }),
  })
  try {
    await waitForHealth(gate.base)
    const result = await createRun(gate.base, "alpha")
    assert.equal(result.status, 409)
    assert.match(result.text, /safety gate blocked capability use/i)
  } finally {
    await stopServer(gate.proc)
    removeTempDir(gateDir)
  }
})

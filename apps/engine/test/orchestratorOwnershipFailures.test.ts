import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { removeTempDir } from "./helpers/fs.js"

const TEST_API_TOKEN = "test-token"
const OWNERSHIP_FAILURE_MESSAGE = "Capability ownership blocked workflow start."

function enginePaths() {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  return {
    engineRoot,
    binPath: resolve(engineRoot, "bin/beerengineer.js"),
    serverPath: resolve(engineRoot, "src/api/server.ts"),
  }
}

function seedCliRepo(repoRoot: string): void {
  mkdirSync(repoRoot, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" })
  writeFileSync(join(repoRoot, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: repoRoot, encoding: "utf8" })
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4700 + Math.floor(Math.random() * 200)
  const host = "127.0.0.1"
  const { serverPath } = enginePaths()
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout?.on("data", () => {})
  proc.stderr?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
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

test("PROJ-8-PRD-2-US-5 TC-28-1: reviewed API workflow surfaces return explicit capability-ownership errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-own-api-"))
  const dbPath = join(dir, "api.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_TEST_CAPABILITY_OWNERSHIP_FAILURE: OWNERSHIP_FAILURE_MESSAGE,
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/runs`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ title: "Blocked run", description: "ownership smoke" }),
    })
    assert.equal(res.status, 409)
    const body = await res.json() as { error: string; code?: string; message?: string; runId?: string }
    assert.equal(body.error, "workflow_capability_blocked")
    assert.equal(body.code, "workflow_capability_blocked")
    assert.equal(body.message, OWNERSHIP_FAILURE_MESSAGE)
    assert.equal(body.runId, undefined)

    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    assert.equal(repos.listRuns().length, 0)
    db.close()
  } finally {
    await stopServer(proc)
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-2-US-5 TC-28-2: reviewed CLI workflow surfaces return explicit capability-ownership errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-own-cli-"))
  const { engineRoot, binPath } = enginePaths()
  const repoRoot = join(dir, "repo")
  seedCliRepo(repoRoot)

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: workspace.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BEERENGINEER_UI_DB_PATH: dbPath,
          BEERENGINEER_ALLOWED_ROOTS: dir,
          BEERENGINEER_TEST_CAPABILITY_OWNERSHIP_FAILURE: OWNERSHIP_FAILURE_MESSAGE,
        },
        timeout: 5000,
      },
    )

    assert.equal(result.status, 75, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stderr ?? "", /Workflow capability ownership blocked the requested action/)
    assert.match(result.stderr ?? "", /Capability ownership blocked workflow start/)
    assert.doesNotMatch(result.stdout ?? "", /applied/)

    const verifyDb = initDatabase(dbPath)
    const verifyRepos = new Repos(verifyDb)
    assert.equal(verifyRepos.listRuns().length, 0)
    verifyDb.close()
  } finally {
    removeTempDir(dir)
  }
})

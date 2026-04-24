import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { main } from "../src/index.js"

test("workspace items lists not-done items first with stage/status context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousDataDir = process.env.BEERENGINEER_DATA_DIR
  const previousConfigPath = process.env.BEERENGINEER_CONFIG_PATH
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_DATA_DIR = dir
    process.env.BEERENGINEER_CONFIG_PATH = join(dir, "config.json")
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const done = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Done item", description: "done" })
    repos.setItemColumn(done.id, "done", "completed")
    const running = repos.createItem({ workspaceId: ws.id, code: "ITEM-0002", title: "Running item", description: "running" })
    repos.setItemColumn(running.id, "implementation", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: running.id, title: running.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "execution" })
    repos.createPendingPrompt({ id: "p-1", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "chat_message", message: "Need answer now" })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["workspace", "items", "demo"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    const runningIndex = stdout.indexOf("ITEM-0002  Running item")
    const doneIndex = stdout.indexOf("ITEM-0001  Done item")
    assert.ok(runningIndex !== -1)
    assert.ok(doneIndex !== -1)
    assert.ok(runningIndex < doneIndex)
    assert.match(stdout, /execution \/ needs_answer/)
    assert.match(stdout, /done \/ done/)
  } finally {
    db.close()
    if (previousDataDir === undefined) delete process.env.BEERENGINEER_DATA_DIR
    else process.env.BEERENGINEER_DATA_DIR = previousDataDir
    if (previousConfigPath === undefined) delete process.env.BEERENGINEER_CONFIG_PATH
    else process.env.BEERENGINEER_CONFIG_PATH = previousConfigPath
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("chat list shows open prompts across workspaces with resolved question text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousDataDir = process.env.BEERENGINEER_DATA_DIR
  const previousConfigPath = process.env.BEERENGINEER_CONFIG_PATH
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_DATA_DIR = dir
    process.env.BEERENGINEER_CONFIG_PATH = join(dir, "config.json")
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0003", title: "Needs answer", description: "chat" })
    repos.setItemColumn(item.id, "requirements", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "chat_message", message: "Which scope do you want?" })
    repos.createPendingPrompt({ id: "p-2", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["chat", "list", "--workspace", "demo"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /demo  ITEM-0003  Needs answer/)
    assert.match(stdout, /requirements \/ needs_answer/)
    assert.match(stdout, /prompt: Which scope do you want\?/)
    assert.match(stdout, new RegExp(run.id))
  } finally {
    db.close()
    if (previousDataDir === undefined) delete process.env.BEERENGINEER_DATA_DIR
    else process.env.BEERENGINEER_DATA_DIR = previousDataDir
    if (previousConfigPath === undefined) delete process.env.BEERENGINEER_CONFIG_PATH
    else process.env.BEERENGINEER_CONFIG_PATH = previousConfigPath
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("workspace use selects the current workspace for items/chats shortcuts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0100", title: "Shortcut item", description: "shortcut" })
    repos.setItemColumn(item.id, "requirements", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "chat_message", message: "Please answer me" })
    repos.createPendingPrompt({ id: "p-shortcut", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["workspace", "use", "demo"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["items"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["chats"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Current workspace: demo/)
    assert.match(stdout, /ITEM-0100  Shortcut item/)
    assert.match(stdout, /requirements \/ needs_answer/)
    assert.match(stdout, /prompt: Please answer me/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("status summarizes the current workspace and repo state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const repoRoot = join(dir, "repo")
  mkdirSync(repoRoot, { recursive: true })
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    assert.equal(spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    writeFileSync(join(repoRoot, "README.md"), "seed\n", "utf8")
    assert.equal(spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" }).status, 0)
    assert.equal(spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" }).status, 0)

    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: repoRoot, lastOpenedAt: Date.now() })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0001", title: "Status item", description: "status" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stage = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-status", runId: run.id, stageRunId: stage.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["status"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Workspace demo/)
    assert.match(stdout, /state: needs_answer/)
    assert.match(stdout, new RegExp(`root: ${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.match(stdout, /git: main \/ clean/)
    assert.match(stdout, /counts: items=1 runs=1 chats=1/)
    assert.match(stdout, /latest run: run\/.* \/ requirements \/ needs_answer/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("status --all summarizes all workspaces with operator-first ordering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath

    const wsIdle = repos.upsertWorkspace({ key: "idle", name: "Idle", rootPath: "/tmp/idle" })
    repos.createItem({ workspaceId: wsIdle.id, code: "ITEM-0001", title: "Idle item", description: "idle" })

    const wsBlocked = repos.upsertWorkspace({ key: "blocked", name: "Blocked", rootPath: "/tmp/blocked" })
    const blockedItem = repos.createItem({ workspaceId: wsBlocked.id, code: "ITEM-0002", title: "Blocked item", description: "blocked" })
    const blockedRun = repos.createRun({ workspaceId: wsBlocked.id, itemId: blockedItem.id, title: blockedItem.title, owner: "cli" })
    repos.updateRun(blockedRun.id, { current_stage: "execution", status: "running", recovery_status: "blocked", recovery_scope: "story" })

    const wsPrompt = repos.upsertWorkspace({ key: "prompt", name: "Prompt", rootPath: "/tmp/prompt", lastOpenedAt: Date.now() })
    const promptItem = repos.createItem({ workspaceId: wsPrompt.id, code: "ITEM-0003", title: "Prompt item", description: "prompt" })
    const promptRun = repos.createRun({ workspaceId: wsPrompt.id, itemId: promptItem.id, title: promptItem.title, owner: "cli" })
    repos.updateRun(promptRun.id, { current_stage: "requirements", status: "running" })
    const stage = repos.createStageRun({ runId: promptRun.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-status-all", runId: promptRun.id, stageRunId: stage.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["status", "--all"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Status across all workspaces/)
    assert.match(stdout, /counts: workspaces=3 items=3 runs=2 chats=1/)
    assert.match(stdout, /prompt\s+needs_answer\s+i=1 r=1 c=1\s+requirements \/ run\//)
    assert.match(stdout, /blocked\s+blocked\s+i=1 r=1 c=0\s+execution \/ run\//)
    assert.match(stdout, /idle\s+idle\s+i=1 r=0 c=0\s+idle/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("chats --all aggregates open prompts across workspaces", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const wsA = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
    const wsB = repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: "/tmp/beta" })
    const itemA = repos.createItem({ workspaceId: wsA.id, code: "ITEM-1000", title: "Alpha item", description: "a" })
    const itemB = repos.createItem({ workspaceId: wsB.id, code: "ITEM-2000", title: "Beta item", description: "b" })
    const runA = repos.createRun({ workspaceId: wsA.id, itemId: itemA.id, title: itemA.title, owner: "cli" })
    const runB = repos.createRun({ workspaceId: wsB.id, itemId: itemB.id, title: itemB.title, owner: "cli" })
    repos.updateRun(runA.id, { current_stage: "requirements", status: "running" })
    repos.updateRun(runB.id, { current_stage: "architecture", status: "running" })
    const stageA = repos.createStageRun({ runId: runA.id, stageKey: "requirements" })
    const stageB = repos.createStageRun({ runId: runB.id, stageKey: "architecture" })
    repos.appendLog({ runId: runA.id, stageRunId: stageA.id, eventType: "chat_message", message: "Alpha question" })
    repos.appendLog({ runId: runB.id, stageRunId: stageB.id, eventType: "chat_message", message: "Beta question" })
    repos.createPendingPrompt({ id: "p-alpha", runId: runA.id, stageRunId: stageA.id, prompt: "  you > " })
    repos.createPendingPrompt({ id: "p-beta", runId: runB.id, stageRunId: stageB.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["chats", "--all"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Open chats across all workspaces/)
    assert.match(stdout, /alpha  ITEM-1000  Alpha item/)
    assert.match(stdout, /beta  ITEM-2000  Beta item/)
    assert.match(stdout, /prompt: Alpha question/)
    assert.match(stdout, /prompt: Beta question/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("items --all aggregates items across workspaces with not-done first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const wsA = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
    const wsB = repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: "/tmp/beta" })
    const running = repos.createItem({ workspaceId: wsB.id, code: "ITEM-0002", title: "Running item", description: "r" })
    repos.setItemColumn(running.id, "requirements", "running")
    const done = repos.createItem({ workspaceId: wsA.id, code: "ITEM-0001", title: "Done item", description: "d" })
    repos.setItemColumn(done.id, "done", "completed")

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["items", "--all"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Items across all workspaces/)
    const runningIndex = stdout.indexOf("beta  ITEM-0002  Running item")
    const doneIndex = stdout.indexOf("alpha  ITEM-0001  Done item")
    assert.ok(runningIndex !== -1)
    assert.ok(doneIndex !== -1)
    assert.ok(runningIndex < doneIndex)
    assert.match(stdout, /requirements \/ running/)
    assert.match(stdout, /done \/ done/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runs --all aggregates runs across workspaces with needs_answer first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const wsA = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
    const wsB = repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: "/tmp/beta" })
    const itemA = repos.createItem({ workspaceId: wsA.id, code: "ITEM-0100", title: "Waiting item", description: "a" })
    const itemB = repos.createItem({ workspaceId: wsB.id, code: "ITEM-0200", title: "Done item", description: "b" })
    const runA = repos.createRun({ workspaceId: wsA.id, itemId: itemA.id, title: itemA.title, owner: "cli" })
    const runB = repos.createRun({ workspaceId: wsB.id, itemId: itemB.id, title: itemB.title, owner: "api" })
    repos.updateRun(runA.id, { current_stage: "requirements", status: "running" })
    repos.updateRun(runB.id, { current_stage: "handoff", status: "completed" })
    const stageA = repos.createStageRun({ runId: runA.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-run-list", runId: runA.id, stageRunId: stageA.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["runs", "--all"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /Runs across all workspaces/)
    const waitingIndex = stdout.indexOf(`alpha  run/${runA.id.slice(0, 8)}  ITEM-0100  Waiting item`)
    const doneIndex = stdout.indexOf(`beta  run/${runB.id.slice(0, 8)}  ITEM-0200  Done item`)
    assert.ok(waitingIndex !== -1)
    assert.ok(doneIndex !== -1)
    assert.ok(waitingIndex < doneIndex)
    assert.match(stdout, /requirements \/ needs_answer \/ cli/)
    assert.match(stdout, /handoff \/ completed \/ api/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("compact list modes render single-line scan tables", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0300", title: "A very long item title for scanning", description: "x" })
    repos.setItemColumn(item.id, "requirements", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stage = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.appendLog({ runId: run.id, stageRunId: stage.id, eventType: "chat_message", message: "A very long prompt that should still stay on one scan line in compact mode" })
    repos.createPendingPrompt({ id: "p-compact", runId: run.id, stageRunId: stage.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["items", "--all", "--compact"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["runs", "--all", "--compact"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["chats", "--all", "--compact"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /workspace  item/)
    assert.match(stdout, /workspace  run/)
    assert.match(stdout, /workspace  item .* prompt/)
    assert.match(stdout, /demo\s+ITEM-0300 A very long item title/)
    assert.match(stdout, /demo\s+[\w-]{8}\s+ITEM-0300 A very long item title/)
    assert.match(stdout, /needs_answer/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("item get shows item detail and resolved open chat in the selected workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0200", title: "Detailed item", description: "detail body" })
    repos.setItemColumn(item.id, "requirements", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "chat_message", message: "What exactly should this prove?" })
    repos.createPendingPrompt({ id: "p-item-get", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["item", "get", "ITEM-0200", "--workspace", "demo"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /ITEM-0200  Detailed item/)
    assert.match(stdout, /workspace: demo/)
    assert.match(stdout, /stage\/status: requirements \/ needs_answer/)
    assert.match(stdout, /run: .* \(running\)/)
    assert.match(stdout, /open chat: What exactly should this prove\?/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run get and chat answer expose run state and resolve prompts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0300", title: "Answerable item", description: "answer body" })
    repos.setItemColumn(item.id, "architecture", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "architecture", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "architecture" })
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "chat_message", message: "Choose the architecture scope." })
    repos.createPendingPrompt({ id: "p-run-get", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["run", "get", run.id])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    }

    try {
      await main(["chat", "answer", "--prompt", "p-run-get", "--text", "Keep it minimal"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, new RegExp(run.id))
    assert.match(stdout, /workspace: demo/)
    assert.match(stdout, /item: ITEM-0300  Answerable item/)
    assert.match(stdout, /open chat: Choose the architecture scope\./)
    assert.match(stdout, /answered p-run-get/)

    const prompt = repos.getPendingPrompt("p-run-get")
    assert.equal(prompt?.answer, "Keep it minimal")
    assert.ok(prompt?.answered_at)
    const answeredLog = repos.listLogsForRun(run.id).find(log => log.event_type === "prompt_answered")
    assert.equal(answeredLog?.message, "Keep it minimal")
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("chat answer can target the latest open prompt by run id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0400", title: "Run target item", description: "run target" })
    repos.setItemColumn(item.id, "requirements", "running")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements", status: "running" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.createPendingPrompt({ id: "p-run-target", runId: run.id, stageRunId: stageRun.id, prompt: "  you > " })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["chat", "answer", "--run", run.id, "--text", "Answer through run"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /answered p-run-target/)
    assert.match(stdout, new RegExp(`run: ${run.id}`))
    assert.match(stdout, /target: latest open prompt for run/)
    assert.equal(repos.getPendingPrompt("p-run-target")?.answer, "Answer through run")
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run watch replays canonical messages and final status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0500", title: "Watch item", description: "watch" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.appendLog({ runId: run.id, eventType: "run_started", message: item.title, data: { itemId: item.id, title: item.title } })
    repos.updateRun(run.id, { current_stage: "requirements", status: "completed" })
    const stageRun = repos.createStageRun({ runId: run.id, stageKey: "requirements" })
    repos.completeStageRun(stageRun.id, "completed")
    repos.appendLog({ runId: run.id, stageRunId: stageRun.id, eventType: "stage_started", message: "requirements", data: { stageKey: "requirements" } })
    repos.appendLog({
      runId: run.id,
      stageRunId: stageRun.id,
      eventType: "chat_message",
      message: "Working through requirements",
      data: { role: "assistant", source: "stage-agent", requiresResponse: true },
    })
    repos.appendLog({
      runId: run.id,
      stageRunId: stageRun.id,
      eventType: "stage_completed",
      message: "requirements",
      data: { stageKey: "requirements", status: "completed" },
    })
    repos.appendLog({
      runId: run.id,
      eventType: "run_finished",
      message: "run completed",
      data: { itemId: item.id, title: item.title, status: "completed" },
    })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["run", "watch", run.id])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /watching .* Watch item/)
    assert.match(stdout, /run started  Watch item/)
    assert.match(stdout, /-> phase  requirements/)
    assert.match(stdout, /agent  Working through requirements/)
    assert.match(stdout, /<- phase  requirements/)
    assert.match(stdout, /done  requirements \/ completed/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runs messages prints canonical JSON payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0501", title: "Messages item", description: "messages" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.appendLog({ runId: run.id, eventType: "run_started", message: item.title, data: { itemId: item.id, title: item.title } })
    repos.appendLog({ runId: run.id, eventType: "chat_message", message: "debug", data: { role: "assistant", source: "stage-agent" } })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["runs", "messages", run.id, "--json"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    const payload = JSON.parse(stdout) as { schema: string; entries: Array<{ type: string }> }
    assert.equal(payload.schema, "messages-v1")
    assert.deepEqual(payload.entries.map(entry => entry.type), ["run_started"])
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runs tail streams new canonical entries from --since and exits blocked with code 11", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0502", title: "Tail item", description: "tail" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    const first = repos.appendLog({ runId: run.id, eventType: "run_started", message: item.title, data: { itemId: item.id, title: item.title } })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    const promise = main(["runs", "tail", run.id, "--since", first.id, "--level", "L2"])
    setTimeout(() => {
      repos.appendLog({
        runId: run.id,
        eventType: "run_blocked",
        message: "Need operator input",
        data: { itemId: item.id, title: item.title, cause: "blocked", scope: { type: "run", runId: run.id } },
      })
    }, 100)

    try {
      await promise
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:11")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /run blocked  Need operator input/)
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("chat send appends a user message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousUiDbPath = process.env.BEERENGINEER_UI_DB_PATH
  const dbPath = join(dir, "beerengineer.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
    const item = repos.createItem({ workspaceId: ws.id, code: "ITEM-0503", title: "Chat send item", description: "chat" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })

    let stdout = ""
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalExit = process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`)
    }) as typeof process.exit

    try {
      await main(["chat", "send", run.id, "Heads", "up"])
      assert.fail("expected main() to exit")
    } catch (err) {
      assert.equal((err as Error).message, "EXIT:0")
    } finally {
      process.stdout.write = originalWrite
      process.exit = originalExit
    }

    assert.match(stdout, /sent/)
    const log = repos.listLogsForRun(run.id).find(row => row.event_type === "chat_message")
    assert.ok(log)
    assert.equal(log?.message, "Heads up")
  } finally {
    db.close()
    if (previousUiDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousUiDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

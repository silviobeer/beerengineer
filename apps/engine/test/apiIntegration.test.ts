import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string; port: number } {
  const port = 4200 + Math.floor(Math.random() * 500)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: { ...process.env, ...env, PORT: String(port), HOST: host, BEERENGINEER_SEED: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  })
  proc.stderr?.on("data", () => {})
  proc.stdout?.on("data", () => {})
  return { proc, base: `http://${host}:${port}`, port }
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve()
    proc.once("exit", () => resolve())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "be2-api-")), "db.sqlite")
}

test("POST /items/:id/actions returns 404 on unknown item", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/items/no-such/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start_brainstorm" })
    })
    assert.equal(res.status, 404)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "item_not_found")
  } finally {
    await stopServer(proc)
  }
})

test("POST /items/:id/actions returns 409 on invalid transition", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  repos.setItemColumn(item.id, "done", "completed")
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/items/${item.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start_brainstorm" })
    })
    assert.equal(res.status, 409)
    const body = await res.json() as { error: string; action: string; current: { column: string; phaseStatus: string } }
    assert.equal(body.error, "invalid_transition")
    assert.equal(body.action, "start_brainstorm")
    assert.equal(body.current.column, "done")
  } finally {
    await stopServer(proc)
  }
})

test("POST /items/:id/actions promotes brainstorm to requirements and persists column", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  repos.setItemColumn(item.id, "brainstorm", "running")
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/items/${item.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "promote_to_requirements" })
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { itemId: string; column: string; phaseStatus: string }
    assert.equal(body.column, "requirements")
    assert.equal(body.phaseStatus, "draft")

    // Verify persisted
    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    const persisted = repos2.getItem(item.id)
    db2.close()
    assert.equal(persisted?.current_column, "requirements")
  } finally {
    await stopServer(proc)
  }
})

test("POST /runs/:id/input returns 409 when run owner='cli'", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "t", owner: "cli" })
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/runs/${run.id}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "anything" })
    })
    assert.equal(res.status, 409)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "cli_owned")
  } finally {
    await stopServer(proc)
  }
})

test("GET /events streams item_column_changed for board-visible actions", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  repos.setItemColumn(item.id, "brainstorm", "running")
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    // Start SSE listener
    const controller = new AbortController()
    const events: string[] = []
    const sseDone = (async () => {
      const res = await fetch(`${base}/events`, { signal: controller.signal })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        for (const line of buf.split("\n")) {
          const m = line.match(/^event: (.+)$/)
          if (m) events.push(m[1])
        }
        buf = buf.split("\n").slice(-1)[0]
        if (events.includes("item_column_changed")) {
          controller.abort()
          break
        }
      }
    })().catch(() => {})

    // Wait briefly so the SSE subscription has been registered server-side.
    await new Promise(r => setTimeout(r, 150))

    const res = await fetch(`${base}/items/${item.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "promote_to_requirements" })
    })
    assert.equal(res.status, 200)

    // Give SSE up to 2s to deliver the event.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && !events.includes("item_column_changed")) {
      await new Promise(r => setTimeout(r, 50))
    }
    controller.abort()
    await sseDone
    assert.ok(events.includes("item_column_changed"), `expected item_column_changed in ${events.join(",")}`)
  } finally {
    await stopServer(proc)
  }
})

test("GET /events?workspace=<key> filters out events from other workspaces", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const w1 = repos.upsertWorkspace({ key: "w1", name: "W1" })
  const w2 = repos.upsertWorkspace({ key: "w2", name: "W2" })
  repos.createItem({ workspaceId: w1.id, title: "w1-item", description: "" })
  const item2 = repos.createItem({ workspaceId: w2.id, title: "w2-item", description: "" })
  repos.setItemColumn(item2.id, "brainstorm", "running")
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const controller = new AbortController()
    const events: string[] = []
    const sseDone = (async () => {
      const res = await fetch(`${base}/events?workspace=w1`, { signal: controller.signal })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split("\n")
        buf = parts.pop() ?? ""
        for (const line of parts) {
          const m = line.match(/^event: (.+)$/)
          if (m) events.push(m[1])
        }
      }
    })().catch(() => {})

    await new Promise(r => setTimeout(r, 150))
    const res = await fetch(`${base}/items/${item2.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "promote_to_requirements" })
    })
    assert.equal(res.status, 200)

    await new Promise(r => setTimeout(r, 400))
    controller.abort()
    await sseDone

    assert.ok(!events.includes("item_column_changed"), `did not expect workspace w2 event in ${events.join(",")}`)
  } finally {
    await stopServer(proc)
  }
})

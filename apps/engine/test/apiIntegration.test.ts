import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { layout } from "../src/core/workspaceLayout.js"

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

const TEST_API_TOKEN = "test-token"

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string; port: number } {
  const port = 4200 + Math.floor(Math.random() * 500)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
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

async function collectSseEvents(url: string, until: (events: string[]) => boolean): Promise<string[]> {
  const controller = new AbortController()
  const events: string[] = []
  const done = (async () => {
    const res = await fetch(url, { signal: controller.signal })
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
        const match = line.match(/^event: (.+)$/)
        if (match) events.push(match[1])
      }
      if (until(events)) {
        controller.abort()
        break
      }
    }
  })().catch(() => {})
  return done.then(() => events)
}

async function collectSseEventsFor(url: string, durationMs: number): Promise<string[]> {
  const controller = new AbortController()
  const events: string[] = []
  const done = (async () => {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.body) return
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const stopAt = Date.now() + durationMs
    while (Date.now() < stopAt) {
      const timeoutMs = Math.max(1, stopAt - Date.now())
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]).catch(err => {
        if ((err as Error).message === "timeout") {
          controller.abort()
          return { done: true, value: undefined }
        }
        throw err
      })
      if (!chunk || chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })
      const parts = buf.split("\n")
      buf = parts.pop() ?? ""
      for (const line of parts) {
        const match = line.match(/^event: (.+)$/)
        if (match) events.push(match[1])
      }
    }
  })().catch(() => {})
  return done.then(() => events)
}

test("POST /items/:id/actions/:action returns 404 on unknown item", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/items/no-such/actions/start_brainstorm`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
    })
    assert.equal(res.status, 404)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "item_not_found")
  } finally {
    await stopServer(proc)
  }
})

test("GET /setup/status returns the doctor report contract", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const dir = mkdtempSync(join(tmpdir(), "be2-setup-"))
  const configPath = join(dir, "config.json")
  const dataDir = join(dir, "data")
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: dataDir,
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/setup/status?group=core`)
    assert.equal(res.status, 200)
    const body = await res.json() as {
      reportVersion: number
      overall: string
      groups: Array<{ id: string }>
    }
    assert.equal(body.reportVersion, 1)
    assert.equal(body.groups.length, 1)
    assert.equal(body.groups[0]?.id, "core")
    assert.equal(body.overall, "blocked")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("GET /notifications/deliveries returns recent delivery rows", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  repos.claimNotificationDelivery({
    dedupKey: "run-1:run_finished",
    channel: "telegram",
    chatId: "123",
  })
  repos.completeNotificationDelivery("run-1:run_finished", { status: "delivered" })
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/notifications/deliveries?channel=telegram&limit=5`)
    assert.equal(res.status, 200)
    const body = await res.json() as {
      deliveries: Array<{ dedup_key: string; channel: string; status: string; attempt_count: number }>
    }
    assert.equal(body.deliveries.length, 1)
    assert.equal(body.deliveries[0]?.dedup_key, "run-1:run_finished")
    assert.equal(body.deliveries[0]?.channel, "telegram")
    assert.equal(body.deliveries[0]?.status, "delivered")
    assert.equal(body.deliveries[0]?.attempt_count, 1)
  } finally {
    await stopServer(proc)
  }
})

test("workspace HTTP endpoints preview, add, get, open, list, remove, and backfill", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-api-"))
  const configPath = join(dir, "config.json")
  const allowedRoot = join(dir, "projects")
  const workspacePath = join(allowedRoot, "api-demo")
  const legacyPath = join(allowedRoot, "legacy")
  const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import("node:fs")
  mkdirSync(allowedRoot, { recursive: true })
  mkdirSync(legacyPath, { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir: join(dir, "data"),
    allowedRoots: [allowedRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
      defaultSonarOrganization: "acme",
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }))

  const seeded = initDatabase(dbPath)
  const seededRepos = new Repos(seeded)
  seededRepos.upsertWorkspace({
    key: "legacy",
    name: "Legacy",
    rootPath: legacyPath,
    harnessProfileJson: JSON.stringify({ mode: "fast" }),
    sonarEnabled: false,
  })
  seeded.close()

  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: join(dir, "data"),
    ANTHROPIC_API_KEY: "anthropic-test",
    OPENAI_API_KEY: "openai-test",
  })
  try {
    await waitForHealth(base)

    const previewRes = await fetch(`${base}/workspaces/preview?path=${encodeURIComponent(workspacePath)}`)
    assert.equal(previewRes.status, 200)
    const preview = await previewRes.json() as { isGreenfield: boolean; isInsideAllowedRoot: boolean }
    assert.equal(preview.isGreenfield, true)
    assert.equal(preview.isInsideAllowedRoot, true)

    const addRes = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        path: workspacePath,
        harnessProfile: { mode: "fast" },
        sonar: { enabled: true },
        git: { init: false },
      }),
    })
    assert.equal(addRes.status, 200)
    const added = await addRes.json() as { workspace: { key: string } }
    assert.equal(added.workspace.key, "api-demo")

    const listRes = await fetch(`${base}/workspaces`)
    assert.equal(listRes.status, 200)
    const list = await listRes.json() as { workspaces: Array<{ key: string }> }
    assert.ok(list.workspaces.some(ws => ws.key === "api-demo"))

    const getRes = await fetch(`${base}/workspaces/api-demo`)
    assert.equal(getRes.status, 200)
    const gotten = await getRes.json() as { key: string; harnessProfile: { mode: string } }
    assert.equal(gotten.key, "api-demo")
    assert.equal(gotten.harnessProfile.mode, "fast")

    const openRes = await fetch(`${base}/workspaces/api-demo/open`, { method: "POST", headers: authHeaders() })
    assert.equal(openRes.status, 200)
    const opened = await openRes.json() as { rootPath: string }
    assert.equal(opened.rootPath, workspacePath)

    const backfillRes = await fetch(`${base}/workspaces/backfill`, { method: "POST", headers: authHeaders() })
    assert.equal(backfillRes.status, 200)
    const backfill = await backfillRes.json() as { written: string[] }
    assert.ok(backfill.written.includes("legacy"))
    assert.ok(existsSync(join(legacyPath, ".beerengineer", "workspace.json")))
    const legacyConfig = JSON.parse(readFileSync(join(legacyPath, ".beerengineer", "workspace.json"), "utf8")) as { key: string }
    assert.equal(legacyConfig.key, "legacy")

    const deleteRes = await fetch(`${base}/workspaces/api-demo`, { method: "DELETE", headers: authHeaders() })
    assert.equal(deleteRes.status, 200)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("workspace HTTP add rejects malformed harnessProfile with 400", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-api-bad-"))
  const configPath = join(dir, "config.json")
  const allowedRoot = join(dir, "projects")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(allowedRoot, { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir: join(dir, "data"),
    allowedRoots: [allowedRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }))
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        path: join(allowedRoot, "bad"),
        harnessProfile: { mode: "does-not-exist" },
      }),
    })
    assert.equal(res.status, 400)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "invalid_harness_profile")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("mutating requests without the CSRF token are rejected with 403", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/tmp/x", harnessProfile: { mode: "fast" } }),
    })
    assert.equal(res.status, 403)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "csrf_token_required")
  } finally {
    await stopServer(proc)
  }
})

test("OPTIONS preflight reflects only the approved UI origin (no wildcard)", async () => {
  const dbPath = tmpDbPath()
  initDatabase(dbPath).close()
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_UI_ORIGIN: "http://127.0.0.1:3100",
  })
  try {
    await waitForHealth(base)
    // Spoofed origin is ignored.
    const spoofed = await fetch(`${base}/workspaces`, {
      method: "OPTIONS",
      headers: { origin: "http://evil.example", "access-control-request-method": "DELETE" },
    })
    assert.notEqual(spoofed.headers.get("access-control-allow-origin"), "*")
    assert.notEqual(spoofed.headers.get("access-control-allow-origin"), "http://evil.example")
    // Approved UI origin is echoed.
    const approved = await fetch(`${base}/workspaces`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:3100", "access-control-request-method": "DELETE" },
    })
    assert.equal(approved.headers.get("access-control-allow-origin"), "http://127.0.0.1:3100")
  } finally {
    await stopServer(proc)
  }
})

test("DELETE purge refuses when stored root_path is outside allowedRoots", async () => {
  const dbPath = tmpDbPath()
  const dir = mkdtempSync(join(tmpdir(), "be2-purge-escape-"))
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs")
  const allowedRoot = join(dir, "projects")
  const outsidePath = join(dir, "outside")
  mkdirSync(allowedRoot, { recursive: true })
  mkdirSync(outsidePath, { recursive: true })
  writeFileSync(join(outsidePath, "keep-me.txt"), "do not delete", "utf8")

  const configPath = join(dir, "config.json")
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir: join(dir, "data"),
    allowedRoots: [allowedRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }))

  // Seed a workspace row whose root_path is outside allowedRoots, simulating a
  // moved directory or a tampered DB.
  const seeded = initDatabase(dbPath)
  new Repos(seeded).upsertWorkspace({
    key: "escape",
    name: "Escape",
    rootPath: outsidePath,
    harnessProfileJson: JSON.stringify({ mode: "fast" }),
  })
  seeded.close()

  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/workspaces/escape?purge=1`, {
      method: "DELETE",
      headers: authHeaders(),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { purgedPath: string | null; purgeSkipped?: { reason: string } }
    assert.equal(body.purgedPath, null)
    assert.equal(body.purgeSkipped?.reason, "path_outside_allowed_roots")
    assert.ok(existsSync(join(outsidePath, "keep-me.txt")), "outside path must not be rm -rf'd")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("POST /items/:id/actions/:action returns 409 on invalid transition", async () => {
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
    const res = await fetch(`${base}/items/${item.id}/actions/start_brainstorm`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
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

test("POST /items/:id/actions/:action promotes brainstorm to requirements and persists column", async () => {
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
    const res = await fetch(`${base}/items/${item.id}/actions/promote_to_requirements`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
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

test("POST /runs/:id/answer accepts answers for cli-owned runs", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "t", owner: "cli" })
  const prompt = repos.createPendingPrompt({ runId: run.id, prompt: "question?" })
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/runs/${run.id}/answer`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ promptId: prompt.id, answer: "anything" })
    })
    assert.equal(res.status, 200)

    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    const answered = repos2.getPendingPrompt(prompt.id)
    db2.close()
    assert.equal(answered?.answer, "anything")
    assert.ok(answered?.answered_at !== null)
  } finally {
    await stopServer(proc)
  }
})

test("design-prep artifact endpoints expose item views and raw artifact files", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Design Prep", description: "" })
  const workspaceId = `design-prep-${item.id.toLowerCase()}`
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli", workspaceFsId: workspaceId })
  repos.updateRun(run.id, { status: "completed" })
  db.close()

  const wireframesDir = layout.stageArtifactsDir({ workspaceId, runId: run.id }, "visual-companion")
  const designDir = layout.stageArtifactsDir({ workspaceId, runId: run.id }, "frontend-design")
  mkdirSync(wireframesDir, { recursive: true })
  mkdirSync(designDir, { recursive: true })
  writeFileSync(join(wireframesDir, "wireframes.json"), JSON.stringify({
    inputMode: "none",
    screens: [{ id: "home", name: "Home", purpose: "Overview", projectIds: ["P01"], layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] }, elements: [] }],
    navigation: { entryPoints: [{ screenId: "home", projectId: "P01" }], flows: [] },
  }))
  writeFileSync(join(wireframesDir, "screen-map.html"), "<html>map</html>")
  writeFileSync(join(wireframesDir, "home.html"), "<html>home</html>")
  writeFileSync(join(designDir, "design.json"), JSON.stringify({
    inputMode: "none",
    tokens: { light: { primary: "#000", secondary: "#111", accent: "#222", background: "#fff", surface: "#f7f7f7", textPrimary: "#111", textMuted: "#666", success: "#0a0", warning: "#aa0", error: "#a00", info: "#00a" } },
    typography: { display: { family: "Fraunces", weight: "700", usage: "Display" }, body: { family: "Manrope", weight: "500", usage: "Body" }, scale: { md: "1rem" } },
    spacing: { baseUnit: "8px", sectionPadding: "32px", cardPadding: "16px", contentMaxWidth: "1200px" },
    borders: { buttons: "999px", cards: "16px", badges: "999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
    tone: "Quiet and practical.",
    antiPatterns: ["generic defaults"],
  }))
  writeFileSync(join(designDir, "design-preview.html"), "<html>preview</html>")

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)

    const itemWireframes = await fetch(`${base}/items/${item.id}/wireframes`)
    assert.equal(itemWireframes.status, 200)
    const wfBody = await itemWireframes.json() as { screenMapUrl: string; screens: Array<{ url: string }> }
    assert.match(wfBody.screenMapUrl, /screen-map\.html$/)
    assert.equal(wfBody.screens.length, 1)

    const itemDesign = await fetch(`${base}/items/${item.id}/design`)
    assert.equal(itemDesign.status, 200)
    const designBody = await itemDesign.json() as { previewUrl: string }
    assert.match(designBody.previewUrl, /design-preview\.html$/)

    const artifacts = await fetch(`${base}/runs/${run.id}/artifacts`)
    assert.equal(artifacts.status, 200)

    const raw = await fetch(`${base}/runs/${run.id}/artifacts/stages/visual-companion/artifacts/screen-map.html`)
    assert.equal(raw.status, 200)
    assert.match(await raw.text(), /map/)
    const headers = raw.headers
    assert.equal(headers.get("x-content-type-options"), "nosniff")
    assert.match(headers.get("content-security-policy") ?? "", /default-src 'none'/)

    // Percent-encoded path-traversal attempts (which the URL parser keeps
    // verbatim) must be rejected with 400 rather than escaping the run dir.
    // Plain `../` sequences are collapsed by the URL parser before they ever
    // reach the server, so only the encoded form needs server-side defense.
    const traversal = await fetch(`${base}/runs/${run.id}/artifacts/..%2F..%2Fetc%2Fpasswd`)
    assert.equal(traversal.status, 400)
    const nullByte = await fetch(`${base}/runs/${run.id}/artifacts/foo%00.html`)
    assert.equal(nullByte.status, 400)
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

    const res = await fetch(`${base}/items/${item.id}/actions/promote_to_requirements`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
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
    const res = await fetch(`${base}/items/${item2.id}/actions/promote_to_requirements`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
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

test("GET /runs/:id/events streams persisted logs for detached cli-owned runs", async () => {
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
    const ssePromise = collectSseEvents(`${base}/runs/${run.id}/events?level=1`, events => events.includes("phase_started"))
    await new Promise(r => setTimeout(r, 150))

    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    repos2.appendLog({ runId: run.id, eventType: "stage_started", message: "stage requirements started" })
    db2.close()

    const events = await ssePromise
    assert.ok(events.includes("hello"))
    assert.ok(events.includes("phase_started"), `expected phase_started in ${events.join(",")}`)
  } finally {
    await stopServer(proc)
  }
})

test("GET /events streams persisted workspace logs for detached cli-owned runs", async () => {
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
    const ssePromise = collectSseEvents(`${base}/events?workspace=t&level=1`, events => events.includes("phase_started"))
    await new Promise(r => setTimeout(r, 150))

    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    repos2.appendLog({ runId: run.id, eventType: "stage_started", message: "stage requirements started" })
    db2.close()

    const events = await ssePromise
    assert.ok(events.includes("hello"))
    assert.ok(events.includes("phase_started"), `expected phase_started in ${events.join(",")}`)
  } finally {
    await stopServer(proc)
  }
})

test("GET /events does not rebroadcast the same persisted workspace log on every poll", async () => {
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
    const ssePromise = collectSseEventsFor(`${base}/events?workspace=t&level=1`, 900)
    await new Promise(r => setTimeout(r, 150))

    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    repos2.appendLog({ runId: run.id, eventType: "stage_started", message: "stage requirements started" })
    db2.close()

    const events = await ssePromise
    assert.equal(
      events.filter(event => event === "phase_started").length,
      1,
      `expected exactly one phase_started event, got ${events.join(",")}`,
    )
  } finally {
    await stopServer(proc)
  }
})

test("GET /runs/:id/messages returns canonical projected messages with level filtering and stable since cursor", async () => {
  const dbPath = tmpDbPath()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "t", owner: "cli" })
  repos.appendLog({ runId: run.id, eventType: "run_started", message: "t", data: { itemId: item.id, title: "t" } })
  repos.appendLog({ runId: run.id, eventType: "chat_message", message: "debug", data: { role: "assistant", source: "stage-agent" } })
  repos.appendLog({
    runId: run.id,
    eventType: "stage_completed",
    message: "stage requirements completed",
    data: { stageKey: "requirements", status: "completed" },
  })
  db.close()

  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const firstRes = await fetch(`${base}/runs/${run.id}/messages?level=2&limit=2`)
    assert.equal(firstRes.status, 200)
    const firstBody = await firstRes.json() as {
      schema: string
      nextSince: string | null
      entries: Array<{ id: string; type: string; level: number }>
    }
    assert.equal(firstBody.schema, "messages-v1")
    assert.deepEqual(firstBody.entries.map(entry => entry.type), ["run_started", "phase_completed"])
    assert.equal(firstBody.entries[0]?.level, 2)
    assert.equal(firstBody.nextSince, firstBody.entries[1]?.id ?? null)

    const secondRes = await fetch(`${base}/runs/${run.id}/messages?level=0&since=${firstBody.entries[0].id}`)
    assert.equal(secondRes.status, 200)
    const secondBody = await secondRes.json() as {
      entries: Array<{ type: string }>
    }
    assert.deepEqual(secondBody.entries.map(entry => entry.type), ["agent_message", "phase_completed"])
  } finally {
    await stopServer(proc)
  }
})

test("POST /runs/:id/messages appends a canonical user message through the API write path", async () => {
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
    const res = await fetch(`${base}/runs/${run.id}/messages`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ text: "Heads up from API" }),
    })
    assert.equal(res.status, 201)
    const body = await res.json() as {
      ok: boolean
      entry: { kind: string; actor: string; text: string } | null
      conversation: { entries: Array<{ text: string; actor: string }> }
    }
    assert.equal(body.ok, true)
    assert.equal(body.entry?.kind, "message")
    assert.equal(body.entry?.actor, "user")
    assert.equal(body.entry?.text, "Heads up from API")
    assert.equal(body.conversation.entries.at(-1)?.text, "Heads up from API")

    const db2 = initDatabase(dbPath)
    const repos2 = new Repos(db2)
    const log = repos2.listLogsForRun(run.id).find(row => row.event_type === "chat_message")
    assert.ok(log)
    assert.equal(log?.message, "Heads up from API")
    assert.match(log?.data_json ?? "", /"source":"api"/)
    db2.close()
  } finally {
    await stopServer(proc)
  }
})

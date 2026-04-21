import { expect, test } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ENGINE_PORT = 4101
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`
const ENGINE_ROOT = resolve(__dirname, "..", "..", "..", "engine")
const TSX_BIN = resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "tsx")

let engineProcess: ChildProcess | null = null
let dbDir: string | null = null

test.beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "be2-e2e-"))
  const dbPath = join(dbDir, "engine.sqlite")
  // spawn tsx directly (no npx wrapper) so SIGTERM reaches the node child
  engineProcess = spawn(TSX_BIN, ["src/api/server.ts"], {
    cwd: ENGINE_ROOT,
    env: {
      ...process.env,
      BEERENGINEER_UI_DB_PATH: dbPath,
      PORT: String(ENGINE_PORT),
      NEXT_PUBLIC_ENGINE_BASE_URL: ENGINE_URL
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  })
  engineProcess.stdout?.on("data", () => {})
  engineProcess.stderr?.on("data", chunk => process.stderr.write(`[engine] ${chunk}`))
  engineProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) console.error(`[engine] exited code=${code} signal=${signal}`)
  })
  // wait for health
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ENGINE_URL}/health`)
      if (res.ok) return
    } catch {
      // not ready
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error("engine did not become healthy")
})

test.afterAll(async () => {
  if (engineProcess && !engineProcess.killed) {
    engineProcess.kill("SIGTERM")
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        engineProcess?.kill("SIGKILL")
        resolve()
      }, 2000)
      engineProcess!.on("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  if (dbDir) rmSync(dbDir, { recursive: true, force: true })
})

test.describe("live run flow", () => {
  test("start a run via API + verify it completes with prompt answers", async ({ request }) => {
    const start = await request.post(`${ENGINE_URL}/runs`, {
      data: { title: "Playwright run", description: "e2e", workspaceKey: "alpha" }
    })
    expect(start.status()).toBe(202)
    const { runId } = (await start.json()) as { runId: string }
    expect(runId).toBeTruthy()

    // drive the run by answering prompts until it finishes
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const runRes = await request.get(`${ENGINE_URL}/runs/${runId}`)
      const run = (await runRes.json()) as { status: string }
      if (run.status === "completed" || run.status === "failed") break

      const promptRes = await request.get(`${ENGINE_URL}/runs/${runId}/prompts`)
      const promptBody = (await promptRes.json()) as { prompt: { id: string } | null }
      if (promptBody.prompt) {
        await request.post(`${ENGINE_URL}/runs/${runId}/input`, {
          data: { promptId: promptBody.prompt.id, answer: "automated driver" }
        })
      }
      await new Promise(r => setTimeout(r, 500))
    }

    const finalRes = await request.get(`${ENGINE_URL}/runs/${runId}`)
    const final = (await finalRes.json()) as { status: string; current_stage: string }
    expect(final.status).toBe("completed")
    expect(final.current_stage).toBe("handoff")

    const tree = (await (await request.get(`${ENGINE_URL}/runs/${runId}/tree`)).json()) as {
      stageRuns: Array<{ stage_key: string; status: string }>
    }
    const stageKeys = tree.stageRuns.map(s => s.stage_key)
    expect(stageKeys).toEqual([
      "brainstorm",
      "requirements",
      "architecture",
      "planning",
      "execution",
      "project-review",
      "qa",
      "documentation",
      "handoff"
    ])
    for (const s of tree.stageRuns) expect(s.status).toBe("completed")
  })

  test("/runs page lists the run and /runs/:id renders the console", async ({ page, request }) => {
    const start = await request.post(`${ENGINE_URL}/runs`, {
      data: { title: "UI console test", description: "visible", workspaceKey: "alpha" }
    })
    expect(start.status()).toBe(202)
    const { runId } = (await start.json()) as { runId: string }

    await page.goto("/runs")
    await expect(page.getByRole("heading", { name: /recent runs/i })).toBeVisible()
    await expect(page.getByText("UI console test").first()).toBeVisible()

    await page.goto(`/runs/${runId}`)
    await expect(page.getByRole("heading", { name: /run console/i })).toBeVisible()
    // The live console reaches out to the engine — at minimum the stage list
    // should appear once the first event streams in.
    await expect(page.locator(".live-run-stages ol li").first()).toBeVisible({ timeout: 15_000 })

    // Clean up the run by driving it to completion so the engine isn't left hanging.
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const runRes = await request.get(`${ENGINE_URL}/runs/${runId}`)
      const run = (await runRes.json()) as { status: string }
      if (run.status === "completed" || run.status === "failed") break
      const prompt = (await (await request.get(`${ENGINE_URL}/runs/${runId}/prompts`)).json()) as {
        prompt: { id: string } | null
      }
      if (prompt.prompt) {
        await request.post(`${ENGINE_URL}/runs/${runId}/input`, {
          data: { promptId: prompt.prompt.id, answer: "ok" }
        })
      }
      await new Promise(r => setTimeout(r, 500))
    }
  })
})

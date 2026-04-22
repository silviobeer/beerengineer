#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ask, close } from "./sim/human.js"
import { createCliIO } from "./core/ioCli.js"
import { initDatabase, resolveDbPath } from "./db/connection.js"
import { Repos } from "./db/repositories.js"
import { runWorkflowWithSync } from "./core/runOrchestrator.js"
import type { ItemRow } from "./db/repositories.js"

type Command =
  | { kind: "help" }
  | { kind: "doctor" }
  | { kind: "start-ui" }
  | { kind: "workflow" }
  | { kind: "item-action"; itemRef: string; action: string }
  | { kind: "unknown"; token: string }

const REQUIRED_TABLES = [
  "workspaces",
  "items",
  "projects",
  "runs",
  "stage_runs",
  "stage_logs",
  "artifact_files",
  "pending_prompts",
] as const

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  if (idx === -1) return undefined
  return argv[idx + 1]
}

export function parseArgs(argv: string[]): Command {
  const [first, second] = argv
  if (first === undefined) return { kind: "workflow" }
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" }
  if (first === "--doctor" || first === "doctor") return { kind: "doctor" }
  if (first === "start" && second === "ui") return { kind: "start-ui" }
  if (first === "item" && second === "action") {
    const itemRef = readFlag(argv, "--item")
    const action = readFlag(argv, "--action")
    if (!itemRef || !action) return { kind: "unknown", token: argv.join(" ") }
    return { kind: "item-action", itemRef, action }
  }
  return { kind: "unknown", token: argv.join(" ") }
}

function printHelp(): void {
  const lines = [
    "",
    "  BeerEngineer2 CLI",
    "",
    "  Usage:",
    "    beerengineer                                         Run the interactive workflow (default)",
    "    beerengineer start ui                                Start the Next.js UI dev server",
    "    beerengineer item action --item <id|code> --action <name>",
    "                                                         Perform an item action",
    "    beerengineer --doctor                                Run environment diagnostics",
    "    beerengineer --help                                  Show this help",
    "",
    "  Item actions:",
    "    start_brainstorm  promote_to_requirements  start_implementation",
    "    resume_run  mark_done",
    "",
    "  Aliases:",
    "    -h  --help",
    "",
  ]
  console.log(lines.join("\n"))
}

export function resolveUiWorkspacePath(): string {
  return resolve(fileURLToPath(new URL("../../ui", import.meta.url)))
}

export function resolveItemReference(
  repos: Repos,
  itemRef: string
): { kind: "found"; item: ItemRow } | { kind: "missing" } | { kind: "ambiguous"; matches: ItemRow[] } {
  const direct = repos.getItem(itemRef)
  if (direct) return { kind: "found", item: direct }

  const byCode = repos.findItemsByCode(itemRef)
  if (byCode.length === 0) return { kind: "missing" }
  if (byCode.length > 1) return { kind: "ambiguous", matches: byCode }
  return { kind: "found", item: byCode[0] }
}

export async function runDoctor(): Promise<number> {
  const checks: { name: string; ok: boolean; detail: string }[] = []

  const nodeVersion = process.versions.node
  const [major] = nodeVersion.split(".").map(Number)
  checks.push({
    name: "Node.js runtime",
    ok: major >= 20,
    detail: `v${nodeVersion}${major >= 20 ? "" : " (>= 20 required)"}`,
  })

  const dbPath = resolveDbPath()
  try {
    const db = initDatabase(dbPath)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const missing = REQUIRED_TABLES.filter((t) => !tables.some((r) => r.name === t))
    db.close()
    checks.push({
      name: "SQLite database",
      ok: missing.length === 0,
      detail: missing.length === 0 ? `${dbPath} (${tables.length} tables)` : `missing: ${missing.join(", ")}`,
    })
  } catch (err) {
    checks.push({ name: "SQLite database", ok: false, detail: `${dbPath}: ${(err as Error).message}` })
  }

  const uiDir = resolveUiWorkspacePath()
  checks.push({
    name: "UI workspace",
    ok: existsSync(resolve(uiDir, "package.json")),
    detail: uiDir,
  })

  console.log("\n  Doctor report:")
  for (const c of checks) {
    const mark = c.ok ? "OK " : "FAIL"
    console.log(`    [${mark}] ${c.name} — ${c.detail}`)
  }

  const failed = checks.filter((c) => !c.ok).length
  console.log(`\n  ${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}\n`)
  return failed === 0 ? 0 : 1
}

export function startUi(): Promise<number> {
  const uiDir = resolveUiWorkspacePath()
  if (!existsSync(resolve(uiDir, "package.json"))) {
    console.error(`  UI workspace not found at ${uiDir}`)
    return Promise.resolve(1)
  }

  console.log(`  Starting UI dev server in ${uiDir}\n`)
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const child = spawn(npm, ["run", "dev"], { cwd: uiDir, stdio: "inherit" })

  return new Promise((resolvePromise) => {
    const forward = (signal: NodeJS.Signals) => child.kill(signal)
    const cleanup = () => {
      process.off("SIGINT", forward)
      process.off("SIGTERM", forward)
    }
    process.on("SIGINT", forward)
    process.on("SIGTERM", forward)
    child.on("exit", (code) => {
      cleanup()
      resolvePromise(code ?? 0)
    })
    child.on("error", (err) => {
      cleanup()
      console.error(`  Failed to start UI: ${err.message}`)
      resolvePromise(1)
    })
  })
}

async function runInteractiveWorkflow(): Promise<void> {
  console.log("\n  ╔════════════════════════════════════════╗")
  console.log("  ║   BeerEngineer2 — Simulation            ║")
  console.log("  ╚════════════════════════════════════════╝\n")

  // Collect the idea *before* we enter the workflow IO scope — `ask()` is used
  // by the orchestrator for mid-run prompts and would otherwise try to persist
  // these intake lines as pending_prompts against a run that doesn't exist yet.
  const title = await ask("  Idea (title):        ")
  const description = await ask("  Idea (description):  ")

  const db = initDatabase()
  const repos = new Repos(db)
  const io = createCliIO(repos)

  try {
    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli" }
    )
    console.log(`\n  run-id: ${runId}`)
  } finally {
    io.close?.()
    close()
    db.close()
  }
}

export async function runItemAction(itemRef: string, action: string): Promise<number> {
  const { createItemActionsService, isItemAction } = await import("./core/itemActions.js")
  if (!isItemAction(action)) {
    console.error(`  Unknown action: ${action}`)
    return 1
  }
  const db = initDatabase()
  const repos = new Repos(db)
  try {
    const resolved = resolveItemReference(repos, itemRef)
    if (resolved.kind === "missing") {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    if (resolved.kind === "ambiguous") {
      console.error(`  Ambiguous item code: ${itemRef}`)
      console.error("  Matching item ids:")
      resolved.matches.forEach(match => console.error(`    ${match.id}`))
      return 1
    }
    const item = resolved.item

    const service = createItemActionsService(repos)
    const result = await service.perform(item.id, action)
    if (!result.ok) {
      if (result.status === 404) console.error(`  Item not found: ${itemRef}`)
      else console.error(`  Invalid transition: ${result.action} from ${result.current.column}/${result.current.phaseStatus}`)
      service.dispose()
      return 1
    }
    console.log(`  ${action} applied`)
    if (result.runId) console.log(`  run-id: ${result.runId}`)
    // For actions that start a run we must wait for it to complete, otherwise
    // the CLI would exit mid-stream. Stage the wait by draining the session.
    if (result.runId) {
      const session = service.sessions.get(result.runId)
      if (session) {
        await new Promise<void>(resolve => {
          session.emitter.on("event", ev => {
            if (ev.type === "run_finished") resolve()
          })
        })
      }
    }
    service.dispose()
    return 0
  } finally {
    db.close()
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cmd = parseArgs(argv)

  switch (cmd.kind) {
    case "help":
      printHelp()
      return
    case "doctor":
      process.exit(await runDoctor())
    case "start-ui":
      process.exit(await startUi())
    case "item-action":
      process.exit(await runItemAction(cmd.itemRef, cmd.action))
    case "unknown":
      console.error(`  Unknown command: ${cmd.token}`)
      printHelp()
      process.exit(1)
    case "workflow":
      try {
        await runInteractiveWorkflow()
      } catch (err) {
        console.error("\n  FEHLER:", (err as Error).message)
        process.exit(1)
      }
      return
  }
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isEntrypoint) {
  main()
}

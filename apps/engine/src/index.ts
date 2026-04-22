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
import { KNOWN_GROUP_IDS } from "./setup/config.js"
import { generateSetupReport, runDoctorCommand, runSetupCommand } from "./setup/doctor.js"

export type ResumeFlags = {
  summary?: string
  branch?: string
  commit?: string
  notes?: string
  yes?: boolean
}

type Command =
  | { kind: "help" }
  | { kind: "doctor"; json?: boolean; group?: string }
  | { kind: "setup"; group?: string; noInteractive?: boolean }
  | { kind: "start-ui" }
  | { kind: "workflow"; json?: boolean }
  | { kind: "item-action"; itemRef: string; action: string; resume?: ResumeFlags }
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

const UI_DEV_HOST = "127.0.0.1"
const UI_DEV_PORT = 3100

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  if (idx === -1) return undefined
  return argv[idx + 1]
}

function isKnownGroupId(group: string): group is (typeof KNOWN_GROUP_IDS)[number] {
  return KNOWN_GROUP_IDS.includes(group as (typeof KNOWN_GROUP_IDS)[number])
}

export function parseArgs(argv: string[]): Command {
  const [first, second] = argv
  const json = argv.includes("--json")
  const group = readFlag(argv, "--group")
  if (first === undefined || first === "--json") return { kind: "workflow", json }
  if (first === "run" && (second === "--json" || argv[2] === "--json" || second === undefined)) {
    return { kind: "workflow", json }
  }
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" }
  if (first === "--doctor" || first === "doctor") return { kind: "doctor", json, group }
  if (first === "setup") return { kind: "setup", group, noInteractive: argv.includes("--no-interactive") }
  if (first === "start" && second === "ui") return { kind: "start-ui" }
  if (first === "item" && second === "action") {
    const itemRef = readFlag(argv, "--item")
    const action = readFlag(argv, "--action")
    if (!itemRef || !action) return { kind: "unknown", token: argv.join(" ") }
    const resume: ResumeFlags = {}
    const summary = readFlag(argv, "--remediation-summary")
    const branch = readFlag(argv, "--branch")
    const commit = readFlag(argv, "--commit")
    const notes = readFlag(argv, "--notes")
    if (summary) resume.summary = summary
    if (branch) resume.branch = branch
    if (commit) resume.commit = commit
    if (notes) resume.notes = notes
    if (argv.includes("--yes")) resume.yes = true
    if (Object.keys(resume).length === 0) {
      return { kind: "item-action", itemRef, action }
    }
    return { kind: "item-action", itemRef, action, resume }
  }
  return { kind: "unknown", token: argv.join(" ") }
}

function printHelp(): void {
  const lines = [
    "",
    "  BeerEngineer2 CLI",
    "",
    "  Usage:",
    "    beerengineer                                         Run the default workflow",
    "    beerengineer --json                                  Harness mode: NDJSON events on stdout, prompt answers on stdin",
    "    beerengineer run --json                              Same as `beerengineer --json`",
    "    beerengineer start ui                                Start the UI on http://127.0.0.1:3100 and open it in the browser",
    "    beerengineer item action --item <id|code> --action <name>",
    "                                                         Perform an item action",
    "    beerengineer doctor [--json] [--group <id>]          Run machine diagnostics",
    "    beerengineer setup [--group <id>] [--no-interactive] Provision app config/data/DB and retry checks",
    "    beerengineer --help                                  Show this help",
    "",
    "  Item actions:",
    "    start_brainstorm  promote_to_requirements  start_implementation",
    "    resume_run  mark_done",
    "",
    "  Resume flags (for --action resume_run on a blocked run):",
    "    --remediation-summary <text>   Required. What you fixed outside BeerEngineer2.",
    "    --branch <name>                Optional. Branch that holds the fix.",
    "    --commit <sha>                 Optional. Fix commit SHA.",
    "    --notes <text>                 Optional. Extra review notes.",
    "    --yes                          Skip the interactive prompt when on a TTY.",
    "",
    "  Workflow behavior:",
    "    User prompts are limited to intake and blocked-run recovery.",
    "    Stage-internal LLM/reviewer interaction still happens, but architecture",
    "    through documentation run without user chat unless a blocker stops the run.",
    "",
    "  Aliases:",
    "    -h  --help  --doctor",
    "",
    "  Setup groups:",
    `    ${KNOWN_GROUP_IDS.join("  ")}`,
    "",
  ]
  console.log(lines.join("\n"))
}

export function resolveUiWorkspacePath(): string {
  return resolve(fileURLToPath(new URL("../../ui", import.meta.url)))
}

export function resolveUiLaunchUrl(): string {
  return `http://${UI_DEV_HOST}:${UI_DEV_PORT}`
}

function openBrowser(url: string): void {
  const platform = process.platform
  const command =
    platform === "darwin"
      ? { cmd: "open", args: [url] }
      : platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", url] }
      : { cmd: "xdg-open", args: [url] }

  try {
    const child = spawn(command.cmd, command.args, {
      stdio: "ignore",
      detached: true,
    })
    child.unref()
  } catch {
    // Browser launch is best-effort; the dev server is still the primary action.
  }
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

export async function runDoctor(options: { json?: boolean; group?: string } = {}): Promise<number> {
  if (options.json) {
    const report = await generateSetupReport({ group: options.group })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.overall === "blocked" ? 1 : 0
  }
  return runDoctorCommand({ group: options.group })
}

export function startUi(): Promise<number> {
  const uiDir = resolveUiWorkspacePath()
  if (!existsSync(resolve(uiDir, "package.json"))) {
    console.error(`  UI workspace not found at ${uiDir}`)
    return Promise.resolve(1)
  }

  const uiUrl = resolveUiLaunchUrl()
  console.log(`  Starting UI dev server in ${uiDir}`)
  console.log(`  Opening ${uiUrl}\n`)
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const child = spawn(npm, ["run", "dev", "--", "--hostname", UI_DEV_HOST, "--port", String(UI_DEV_PORT)], {
    cwd: uiDir,
    stdio: "inherit"
  })
  openBrowser(uiUrl)

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

async function runInteractiveWorkflow(opts: { json?: boolean } = {}): Promise<void> {
  if (opts.json) {
    return runJsonWorkflow()
  }

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

/**
 * Harness mode. Stdout carries one `WorkflowEvent` JSON object per line.
 * Stdin is read line-by-line; `{"type":"prompt_answered","promptId":"…","answer":"…"}`
 * resolves the matching pending prompt. Human formatting is disabled so
 * stdout stays machine-parseable; errors go to stderr.
 *
 * Intake (title/description) is supplied by the harness via a special
 * bootstrap prompt — the run starts by asking for them as regular events.
 */
async function runJsonWorkflow(): Promise<void> {
  const { attachNdjsonRenderer } = await import("./core/renderers/ndjson.js")
  const db = initDatabase()
  const repos = new Repos(db)
  const io = createCliIO(repos, {
    renderer: (bus) => attachNdjsonRenderer(bus),
    externalPromptResolver: true,
  })

  try {
    // Intake prompts go through the same bus — harness reads prompt_requested,
    // replies with prompt_answered for "title" and "description".
    const title = await io.ask("Idea (title)")
    const description = await io.ask("Idea (description)")

    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli" }
    )
    // Emit a final signpost event so the harness can detect end-of-run.
    process.stdout.write(`${JSON.stringify({ type: "cli_finished", runId })}\n`)
  } finally {
    io.close?.()
    db.close()
  }
}

async function collectRemediationFlags(flags: ResumeFlags, interactive: boolean): Promise<ResumeFlags | null> {
  const out: ResumeFlags = { ...flags }
  if (interactive && !out.summary) {
    const { ask, close } = await import("./sim/human.js")
    try {
      out.summary = (await ask("  Remediation summary (required): ")).trim() || undefined
      if (!out.branch) out.branch = (await ask("  Branch (optional):            ")).trim() || undefined
      if (!out.notes) out.notes = (await ask("  Review notes (optional):      ")).trim() || undefined
    } finally {
      close()
    }
  }
  if (!out.summary) return null
  return out
}

function printResumeBlockedOutput(
  runId: string,
  recovery: { summary: string | null; scope: string | null; scopeRef: string | null },
  itemRef: string,
): void {
  console.error(`\n  Run ${runId} is blocked.`)
  if (recovery.summary) console.error(`  Reason: ${recovery.summary}`)
  if (recovery.scope) console.error(`  Scope:  ${recovery.scope}${recovery.scopeRef ? ` (${recovery.scopeRef})` : ""}`)
  console.error(
    `  Resume with: beerengineer item action --item ${itemRef} --action resume_run --remediation-summary "<what you fixed>"`,
  )
}

export async function runItemAction(itemRef: string, action: string, resumeFlags?: ResumeFlags): Promise<number> {
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

    if (action === "start_brainstorm") {
      if (item.current_column !== "idea" || item.phase_status !== "draft") {
        console.error(`  Invalid transition: ${action} from ${item.current_column}/${item.phase_status}`)
        return 1
      }
      const io = createCliIO(repos)
      try {
        const runId = await runWorkflowWithSync(
          { id: item.id, title: item.title, description: item.description },
          repos,
          io,
          { owner: "cli", itemId: item.id }
        )
        console.log(`  ${action} applied`)
        console.log(`  run-id: ${runId}`)
        return 0
      } finally {
        io.close?.()
      }
    }

    // For resume_run, preflight-check whether the active run actually has a
    // recovery record. If it does, collect remediation fields before calling
    // perform() so we can fail fast in non-TTY mode with exit 75.
    let resumePayload: { summary: string; branch?: string; commitSha?: string; reviewNotes?: string } | undefined
    let resumeRunId: string | undefined
    if (action === "resume_run") {
      const active = repos.latestActiveRunForItem(item.id) ?? repos.latestRecoverableRunForItem(item.id)
      resumeRunId = active?.id
      if (active?.recovery_status) {
        const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY) && resumeFlags?.yes !== true
        const collected = await collectRemediationFlags(resumeFlags ?? {}, isTty)
        if (!collected || !collected.summary) {
          printResumeBlockedOutput(active.id, {
            summary: active.recovery_summary,
            scope: active.recovery_scope,
            scopeRef: active.recovery_scope_ref,
          }, itemRef)
          console.error("  Missing --remediation-summary (required for non-interactive resume).")
          return 75
        }
        resumePayload = {
          summary: collected.summary,
          branch: collected.branch,
          commitSha: collected.commit,
          reviewNotes: collected.notes
        }
      }
    }

    if (action === "resume_run" && resumePayload && resumeRunId) {
      const { loadResumeReadiness, performResume } = await import("./core/resume.js")
      const readiness = await loadResumeReadiness(repos, resumeRunId)
      if (readiness.kind === "not_found") {
        console.error(`  Item not found: ${itemRef}`)
        return 1
      }
      if (readiness.kind === "not_resumable") {
        console.error(`  Not resumable: ${readiness.reason}`)
        return 2
      }
      if (readiness.kind === "no_recovery") {
        console.error(`  Invalid transition: ${action} from ${item.current_column}/${item.phase_status}`)
        return 1
      }

      const scopeRef =
        readiness.record.scope.type === "stage"
          ? readiness.record.scope.stageId
          : readiness.record.scope.type === "story"
          ? `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
          : null
      const remediation = repos.createExternalRemediation({
        runId: resumeRunId,
        scope: readiness.record.scope.type,
        scopeRef,
        summary: resumePayload.summary,
        branch: resumePayload.branch,
        commitSha: resumePayload.commitSha,
        reviewNotes: resumePayload.reviewNotes,
        source: "cli"
      })

      const io = createCliIO(repos)
      try {
        console.log(`  ${action} applied`)
        console.log(`  run-id: ${resumeRunId}`)
        console.log(`  remediation-id: ${remediation.id}`)
        await performResume({ repos, io, runId: resumeRunId, remediation })
        const refreshed = repos.getRun(resumeRunId)
        if (refreshed?.recovery_status === "blocked") {
          printResumeBlockedOutput(resumeRunId, {
            summary: refreshed.recovery_summary,
            scope: refreshed.recovery_scope,
            scopeRef: refreshed.recovery_scope_ref,
          }, itemRef)
        }
        return 0
      } finally {
        io.close?.()
      }
    }

    const service = createItemActionsService(repos)
    const result = await service.perform(item.id, action, resumePayload ? { resume: resumePayload } : undefined)
    if (!result.ok) {
      if (result.status === 404) console.error(`  Item not found: ${itemRef}`)
      else if (result.status === 422) {
        console.error(`  Missing remediation summary (pass --remediation-summary).`)
        service.dispose()
        return 75
      } else if (result.error === "not_resumable" || result.error === "resume_in_progress") {
        console.error(`  Not resumable: ${result.error}`)
        service.dispose()
        return 2
      } else {
        console.error(`  Invalid transition: ${result.action} from ${result.current.column}/${result.current.phaseStatus}`)
      }
      service.dispose()
      return 1
    }
    console.log(`  ${action} applied`)
    if (result.runId) console.log(`  run-id: ${result.runId}`)
    if (result.remediationId) console.log(`  remediation-id: ${result.remediationId}`)
    if (result.runId) {
      const session = service.sessions.get(result.runId)
      if (session) {
        await new Promise<void>(resolve => {
          session.emitter.on("event", ev => {
            if (ev.type === "run_finished") resolve()
          })
        })
        // If the run re-blocked, print the new recovery summary so the
        // operator sees the next fix cycle up front.
        const refreshed = repos.getRun(result.runId)
        if (refreshed?.recovery_status === "blocked") {
          printResumeBlockedOutput(result.runId, {
            summary: refreshed.recovery_summary,
            scope: refreshed.recovery_scope,
            scopeRef: refreshed.recovery_scope_ref,
          }, itemRef)
        }
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
      if (cmd.group && !isKnownGroupId(cmd.group)) {
        console.error(`  Unknown setup group: ${cmd.group}`)
        process.exit(2)
      }
      process.exit(await runDoctor({ json: cmd.json, group: cmd.group }))
    case "setup":
      if (cmd.group && !isKnownGroupId(cmd.group)) {
        console.error(`  Unknown setup group: ${cmd.group}`)
        process.exit(2)
      }
      process.exit(await runSetupCommand({ group: cmd.group, noInteractive: cmd.noInteractive }))
    case "start-ui":
      process.exit(await startUi())
    case "item-action":
      process.exit(await runItemAction(cmd.itemRef, cmd.action, cmd.resume))
    case "unknown":
      console.error(`  Unknown command: ${cmd.token}`)
      printHelp()
      process.exit(1)
    case "workflow":
      try {
        await runInteractiveWorkflow({ json: cmd.json })
      } catch (err) {
        if (cmd.json) {
          process.stderr.write(`${JSON.stringify({ type: "cli_error", message: (err as Error).message })}\n`)
        } else {
          console.error("\n  FEHLER:", (err as Error).message)
        }
        process.exit(1)
      }
      return
  }
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isEntrypoint) {
  main()
}

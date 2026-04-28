#!/usr/bin/env node

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ask, close } from "./sim/human.js"
import { createCliIO } from "./core/ioCli.js"
import { createGitAdapterFromMode } from "./core/gitAdapter.js"
import { inspectWorkspaceState } from "./core/git.js"
import { layout } from "./core/workspaceLayout.js"
import { latestCompletedRunForItem } from "./core/itemWorkspace.js"
import { resolveItemPreviewContext } from "./core/itemPreview.js"
import { isPortListening, resolvePreviewLaunchSpec, startPreviewServer } from "./core/previewLauncher.js"
import { resolveWorkflowContextForItemRun, resolveWorkflowContextForRun } from "./core/workflowContextResolver.js"
import {
  backfillWorkspaceConfigs,
  getRegisteredWorkspace,
  listRegisteredWorkspaces,
  openWorkspace,
  previewWorkspace,
  promptForWorkspaceAddDefaults,
  registerWorkspace,
  removeWorkspace,
} from "./core/workspaces.js"
import { initDatabase } from "./db/connection.js"
import { Repos } from "./db/repositories.js"
import { prepareRun, runWorkflowWithSync } from "./core/runOrchestrator.js"
import type { ItemRow } from "./db/repositories.js"
import type { ItemAction } from "./core/itemActions.js"
import { projectStageLogRow, type MessageEntry } from "./core/messagingProjection.js"
import { messagingLevelFromQuery, shouldDeliverAtLevel, type MessagingLevel } from "./core/messagingLevel.js"
import { renderMessageEntry, terminalExitCodeForEntry } from "./core/messageRendering.js"
import { tailStageLogs } from "./api/sse/tailStageLogs.js"
import { readApiTokenFile } from "./api/tokenFile.js"
import { readEnginePidFile } from "./api/pidFile.js"
import {
  KNOWN_GROUP_IDS,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
  validateHarnessProfileShape,
} from "./setup/config.js"
import { generateSetupReport, runDoctorCommand, runSetupCommand } from "./setup/doctor.js"
import type { AppConfig } from "./setup/types.js"
import type { HarnessProfile, RegisterWorkspaceInput } from "./types/workspace.js"
import { sendTelegramTestNotification } from "./notifications/command.js"
import type { DesignArtifact, WireframeArtifact } from "./types.js"
import { buildUpdateStatus, markPreparedUpdateInFlight, prepareUpdateApply, runUpdateCheck, runUpdateDryRun } from "./core/updateMode.js"

export type ResumeFlags = {
  summary?: string
  branch?: string
  commit?: string
  notes?: string
  yes?: boolean
}

type Command =
  | { kind: "help" }
  | { kind: "start-engine" }
  | { kind: "doctor"; json?: boolean; group?: string }
  | { kind: "setup"; group?: string; noInteractive?: boolean }
  | {
      kind: "update"
      check?: boolean
      json?: boolean
      dryRun?: boolean
      rollback?: boolean
      version?: string
      allowLegacyDbShadow?: boolean
    }
  | { kind: "notifications-test"; channel: "telegram" }
  | { kind: "start-ui" }
  | { kind: "workflow"; json?: boolean; workspaceKey?: string; verbose?: boolean }
  | { kind: "item-action"; itemRef: string; action: string; resume?: ResumeFlags }
  | { kind: "workspace-preview"; path?: string; json?: boolean }
  | {
      kind: "workspace-add"
      json?: boolean
      noInteractive?: boolean
      path?: string
      name?: string
      key?: string
      profile?: string
      profileJson?: string
      sonar?: boolean
      sonarKey?: string
      sonarOrg?: string
      sonarHost?: string
      sonarToken?: string
      sonarTokenPersist?: boolean
      noGit?: boolean
      ghCreate?: boolean
      ghPublic?: boolean
      ghOwner?: string
    }
  | { kind: "workspace-list"; json?: boolean }
  | { kind: "workspace-get"; key?: string; json?: boolean }
  | { kind: "workspace-items"; key?: string; json?: boolean }
  | { kind: "workspace-use"; key?: string }
  | { kind: "workspace-remove"; key?: string; json?: boolean; purge?: boolean; yes?: boolean; noInteractive?: boolean }
  | { kind: "workspace-open"; key?: string }
  | { kind: "workspace-backfill"; json?: boolean }
  | { kind: "workspace-worktree-gc"; key?: string; json?: boolean }
  | { kind: "status"; workspaceKey?: string; json?: boolean; all?: boolean }
  | { kind: "chat-list"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "chat-send"; runId?: string; text?: string; json?: boolean }
  | { kind: "chat-answer"; promptId?: string; runId?: string; answer?: string; multiline?: boolean; editor?: boolean; json?: boolean }
  | { kind: "items"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "chats"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "runs"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "item-get"; itemRef?: string; workspaceKey?: string; json?: boolean }
  | { kind: "item-open"; itemRef?: string; workspaceKey?: string }
  | { kind: "item-preview"; itemRef?: string; workspaceKey?: string; start?: boolean; open?: boolean; json?: boolean }
  | { kind: "item-wireframes"; itemRef?: string; workspaceKey?: string; open?: boolean; json?: boolean }
  | { kind: "item-design"; itemRef?: string; workspaceKey?: string; open?: boolean; json?: boolean }
  | { kind: "run-list"; workspaceKey?: string; json?: boolean; all?: boolean; compact?: boolean }
  | { kind: "run-get"; runId?: string; json?: boolean }
  | { kind: "run-open"; runId?: string }
  | { kind: "run-tail"; runId?: string; level: MessagingLevel; since?: string; json?: boolean }
  | { kind: "run-messages"; runId?: string; level: MessagingLevel; since?: string; limit: number; json?: boolean }
  | { kind: "run-watch"; runId?: string; level: MessagingLevel; since?: string; json?: boolean }
  | { kind: "unknown"; token: string }

const UI_DEV_HOST = "127.0.0.1"
const UI_DEV_PORT = 3100
const EXIT_USAGE = 20
const EXIT_TRANSPORT = 30

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
  const workspaceKey = readFlag(argv, "--workspace")
  const all = argv.includes("--all")
  const compact = argv.includes("--compact")
  const since = readFlag(argv, "--since")
  const level = messagingLevelFromQuery(readFlag(argv, "--level"), 1)
  const messagesLevel = messagingLevelFromQuery(readFlag(argv, "--level"), 2)
  const rawLimit = Number(readFlag(argv, "--limit") ?? 200)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200
  const positionalThird = argv[2] && !argv[2].startsWith("--") ? argv[2] : undefined
  if (first === undefined || first === "--json" || first === "--workspace") {
    return { kind: "workflow", json, workspaceKey, verbose: argv.includes("--verbose") }
  }
  if (first === "run") {
    if (second === undefined || second === "--json" || second === "--workspace" || second === "--verbose") {
      return { kind: "workflow", json, workspaceKey, verbose: argv.includes("--verbose") }
    }
    if (second === "list") return { kind: "run-list", workspaceKey, json, all, compact }
    if (second === "get") return { kind: "run-get", runId: argv[2], json }
    if (second === "open") return { kind: "run-open", runId: argv[2] }
    if (second === "tail") return { kind: "run-tail", runId: argv[2], level, since, json }
    if (second === "messages") return { kind: "run-messages", runId: argv[2], level: messagesLevel, since, limit, json }
    if (second === "watch") return { kind: "run-watch", runId: argv[2], level, since, json }
    return { kind: "unknown", token: argv.join(" ") }
  }
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" }
  if (first === "--doctor" || first === "doctor") return { kind: "doctor", json, group }
  if (first === "setup") return { kind: "setup", group, noInteractive: argv.includes("--no-interactive") }
  if (first === "update") {
    return {
      kind: "update",
      check: argv.includes("--check"),
      json,
      dryRun: argv.includes("--dry-run"),
      rollback: argv.includes("--rollback"),
      version: readFlag(argv, "--version"),
      allowLegacyDbShadow: argv.includes("--allow-legacy-db-shadow"),
    }
  }
  if (first === "notifications" && second === "test" && argv[2] === "telegram") return { kind: "notifications-test", channel: "telegram" }
  if (first === "status") return { kind: "status", workspaceKey, json, all }
  if (first === "workspace" && second === "preview") return { kind: "workspace-preview", path: argv[2], json }
  if (first === "workspace" && second === "add") {
    return {
      kind: "workspace-add",
      json,
      noInteractive: argv.includes("--no-interactive"),
      path: readFlag(argv, "--path") ?? argv[2],
      name: readFlag(argv, "--name"),
      key: readFlag(argv, "--key"),
      profile: readFlag(argv, "--profile"),
      profileJson: readFlag(argv, "--profile-json"),
      sonar: argv.includes("--sonar"),
      sonarKey: readFlag(argv, "--sonar-key"),
      sonarOrg: readFlag(argv, "--sonar-org"),
      sonarHost: readFlag(argv, "--sonar-host"),
      sonarToken: readFlag(argv, "--sonar-token"),
      sonarTokenPersist: !argv.includes("--no-sonar-token-persist"),
      noGit: argv.includes("--no-git"),
      ghCreate: argv.includes("--gh-create"),
      ghPublic: argv.includes("--gh-public"),
      ghOwner: readFlag(argv, "--gh-owner"),
    }
  }
  if (first === "workspace" && second === "list") return { kind: "workspace-list", json }
  if (first === "workspace" && second === "get") return { kind: "workspace-get", key: argv[2], json }
  if (first === "workspace" && second === "items") return { kind: "workspace-items", key: argv[2], json }
  if (first === "workspace" && second === "use") return { kind: "workspace-use", key: argv[2] }
  if (first === "workspace" && second === "remove") return {
    kind: "workspace-remove",
    key: argv[2],
    json,
    purge: argv.includes("--purge"),
    yes: argv.includes("--yes"),
    noInteractive: argv.includes("--no-interactive"),
  }
  if (first === "workspace" && second === "open") return { kind: "workspace-open", key: argv[2] }
  if (first === "workspace" && second === "backfill") return { kind: "workspace-backfill", json }
  if (first === "workspace" && second === "gc-worktrees") return { kind: "workspace-worktree-gc", key: argv[2], json }
  if (first === "chat" && second === "list") return { kind: "chat-list", workspaceKey, json, all, compact }
  if (first === "chat" && second === "send") {
    return {
      kind: "chat-send",
      runId: positionalThird ?? readFlag(argv, "--run"),
      text: argv.slice(3).filter(part => !part.startsWith("--")).join(" ") || readFlag(argv, "--text"),
      json,
    }
  }
  if (first === "chat" && second === "answer") {
    const positionalRunId = positionalThird
    const positionalAnswer =
      positionalRunId ? argv.slice(3).filter(part => !part.startsWith("--")).join(" ") || undefined : undefined
    return {
      kind: "chat-answer",
      promptId: readFlag(argv, "--prompt"),
      runId: readFlag(argv, "--run") ?? positionalRunId,
      answer: readFlag(argv, "--text") ?? positionalAnswer,
      multiline: argv.includes("--multiline"),
      editor: argv.includes("--editor"),
      json,
    }
  }
  if (first === "items") return { kind: "items", workspaceKey, json, all, compact }
  if (first === "chats") return { kind: "chats", workspaceKey, json, all, compact }
  if (first === "runs") {
    if (second === "tail") return { kind: "run-tail", runId: argv[2], level, since, json }
    if (second === "messages") return { kind: "run-messages", runId: argv[2], level: messagesLevel, since, limit, json }
    if (second === "watch") return { kind: "run-watch", runId: argv[2], level, since, json }
    return { kind: "runs", workspaceKey, json, all, compact }
  }
  if (first === "item" && second === "get") return { kind: "item-get", itemRef: argv[2], workspaceKey, json }
  if (first === "item" && second === "open") return { kind: "item-open", itemRef: argv[2], workspaceKey }
  if (first === "item" && second === "preview") return { kind: "item-preview", itemRef: argv[2], workspaceKey, start: argv.includes("--start"), open: argv.includes("--open"), json }
  if (first === "item" && second === "wireframes") return { kind: "item-wireframes", itemRef: argv[2], workspaceKey, open: argv.includes("--open"), json }
  if (first === "item" && second === "design") return { kind: "item-design", itemRef: argv[2], workspaceKey, open: argv.includes("--open"), json }
  if (first === "start" && second === undefined) return { kind: "start-engine" }
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
    "    beerengineer start                                   Start the local engine HTTP API (http://127.0.0.1:4100)",
    "    beerengineer start ui                                Start the local UI dev server (http://127.0.0.1:3100)",
    "    beerengineer status [--all] [--json]                Workspace status overview",
    "    beerengineer items [--all] [--compact]              List items",
    "    beerengineer chats [--all] [--compact]              List open chats",
    "    beerengineer runs [--all] [--compact]               List runs",
    "    beerengineer item action --item <id|code> --action <name>",
    "                                                         Perform an item action",
    "    beerengineer doctor [--json] [--group <id>]          Run machine diagnostics",
    "    beerengineer setup [--group <id>] [--no-interactive] Provision app config/data/DB and retry checks",
    "    beerengineer update [--json] [--version <tag>]       Stage and queue an update apply attempt",
    "    beerengineer update --check [--json]                 Check the newest GitHub release against the current install",
    "    beerengineer update --dry-run [--json]               Run update preflight checks without shutting the engine down",
    "    beerengineer update --rollback [--json]              Reserved; returns post-migration rollback unsupported",
    "    beerengineer notifications test telegram             Send a Telegram test notification",
    "    beerengineer workspace preview <path> [--json]       Preview workspace registration",
    "    beerengineer workspace add [--path <p>] [flags]      Register a workspace",
    "                                                         [--name <n>] [--key <k>] [--profile <json>|--profile-json <file>]",
    "                                                         [--sonar] [--sonar-token <t>] [--no-sonar-token-persist]",
    "                                                         [--sonar-key <k>] [--sonar-org <o>] [--sonar-host <url>]",
    "                                                         [--no-git] [--gh-create] [--gh-public] [--gh-owner <user>]",
    "                                                         [--no-interactive] [--json]",
    "    beerengineer workspace list [--json]                 List registered workspaces",
    "    beerengineer workspace get <key> [--json]            Get one workspace",
    "    beerengineer workspace items <key> [--json]          List items for one workspace",
    "    beerengineer workspace use <key>                     Select the current workspace",
    "    beerengineer workspace remove <key> [--purge] [--yes]",
    "                                                         Unregister a workspace (--purge also rm -rf's root; --yes skips confirm)",
    "    beerengineer workspace open <key>                    Print the workspace root path",
    "    beerengineer workspace backfill [--json]             Write missing .beerengineer/workspace.json files",
    "    beerengineer workspace gc-worktrees <key> [--json]   Remove orphaned BeerEngineer story worktrees",
    "    beerengineer item get <id|code> [--workspace <key>]  Show one item",
    "    beerengineer item open <id|code> [--workspace <key>] Open one item in the UI",
    "    beerengineer item preview <id|code> [--start] [--open] [--workspace <key>] [--json]",
    "                                                         Show or start the item-branch local preview",
    "    beerengineer item wireframes <id|code> [--open] [--workspace <key>] [--json]",
    "                                                         Show/open wireframe artifacts",
    "    beerengineer item design <id|code> [--open] [--workspace <key>] [--json]",
    "                                                         Show/open design artifact",
    "    beerengineer run list [--all] [--compact]            List runs",
    "    beerengineer run get <run-id> [--json]               Show one run",
    "    beerengineer runs messages <run-id> [--level L2]    Show canonical message history",
    "                                                         Flags: [--since <id>] [--limit N] [--json]",
    "    beerengineer runs tail <run-id> [--level L1]        Tail canonical message stream",
    "                                                         Flags: [--since <id>] [--json]",
    "    beerengineer runs watch <run-id> [--level L1]       Replay history, then tail live",
    "                                                         Flags: [--since <id>] [--json]",
    "    beerengineer run open <run-id>                       Open one run in the UI",
    "    beerengineer chat list [--all] [--compact]           List open prompts",
    "    beerengineer chat send <run-id> <text>              Send a free-form user message",
    "    beerengineer chat answer (--prompt <id>|--run <id>)  Answer a prompt",
    "    beerengineer chat answer <run-id> <text>             Positional shortcut for the active prompt",
    "    beerengineer --help                                  Show this help",
    "",
    "  Item actions:",
    "    start_brainstorm  start_visual_companion  start_frontend_design",
    "    promote_to_requirements  start_implementation  rerun_design_prep",
    "    promote_to_base  cancel_promotion  resume_run  mark_done",
    "",
    "  Resume flags (for --action resume_run on a blocked run):",
    "    --remediation-summary <text>   Required. What you fixed outside BeerEngineer2.",
    "    --branch <name>                Optional. Branch that holds the fix.",
    "    --commit <sha>                 Optional. Fix commit SHA.",
    "    --notes <text>                 Optional. Extra review notes.",
    "    --yes                          Skip the interactive prompt when on a TTY.",
    "",
    "  Message levels:",
    "    L2  milestones only",
    "    L1  milestones plus operational detail",
    "    L0  full debug stream",
    "",
    "  Workflow behavior:",
    "    User prompts are limited to intake and blocked-run recovery.",
    "    Stage-internal LLM/reviewer interaction still happens, but stages from",
    "    architecture through documentation run without user chat unless a blocker stops the run.",
    "    Items with UI additionally run two item-scoped stages — visual-companion",
    "    and frontend-design — between brainstorm and requirements. Both are",
    "    silently skipped when item-level hasUi === false.",
    "    After project handoff, items stop in merge-gate before landing on the",
    "    base branch. Managed previews use a per-worktree port from",
    "    BEERENGINEER_WORKTREE_PORT_POOL.",
    "",
    "  Aliases:",
    "    -h  --help  --doctor  items  chats  runs",
    "",
    "  Quick start:",
    "    beerengineer workspace list",
    "    beerengineer workspace use <key>",
    "    beerengineer status",
    "    beerengineer items",
    "    beerengineer chats",
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

function resolveCliStatePath(): string {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  return join(dirname(configPath), "cli-state.json")
}

function loadCliState(): { currentWorkspaceKey?: string } {
  try {
    return JSON.parse(readFileSync(resolveCliStatePath(), "utf8")) as { currentWorkspaceKey?: string }
  } catch {
    return {}
  }
}

function saveCliState(patch: { currentWorkspaceKey?: string }): void {
  const statePath = resolveCliStatePath()
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify({ ...loadCliState(), ...patch }, null, 2), "utf8")
}

function isGenericPrompt(prompt: string | null | undefined): boolean {
  return !prompt || /^\s*you\s*>\s*$/i.test(prompt)
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8)
}

function latestRunForItem(repos: Repos, itemId: string) {
  return repos
    .listRuns()
    .filter(run => run.item_id === itemId)
    .sort((a, b) => b.created_at - a.created_at)[0]
}

function latestQuestionForRun(repos: Repos, runId: string): string | null {
  return repos
    .listLogsForRun(runId)
    .filter(log => log.event_type === "chat_message" && log.message.trim().length > 0)
    .sort((a, b) => b.created_at - a.created_at)[0]?.message ?? null
}

function latestAnswerForRun(repos: Repos, runId: string): string | null {
  return repos
    .listLogsForRun(runId)
    .filter(log => log.event_type === "prompt_answered" && log.message.trim().length > 0)
    .sort((a, b) => b.created_at - a.created_at)[0]?.message ?? null
}

function promptDisplayText(repos: Repos, prompt: { run_id: string; prompt: string }): string {
  return isGenericPrompt(prompt.prompt) ? latestQuestionForRun(repos, prompt.run_id) ?? prompt.prompt : prompt.prompt
}

function deriveRunStatus(run: { status: string; recovery_status: string | null }, hasPrompt: boolean): string {
  if (hasPrompt) return "needs_answer"
  if (run.recovery_status === "blocked") return "blocked"
  if (run.recovery_status === "failed" || run.status === "failed") return "failed"
  if (run.status === "completed") return "completed"
  return run.status
}

function deriveItemStatus(
  item: Pick<ItemRow, "current_column" | "phase_status">,
  latestRun: { status: string; recovery_status: string | null } | undefined,
  hasPrompt: boolean,
): string {
  if (hasPrompt) return "needs_answer"
  if (latestRun?.recovery_status === "blocked") return "blocked"
  if (item.phase_status === "review_required") return "review_required"
  if (latestRun?.recovery_status === "failed" || item.phase_status === "failed") return "failed"
  if (item.current_column === "done" && item.phase_status === "completed") return "done"
  return item.phase_status
}

function itemSortWeight(status: string): number {
  switch (status) {
    case "needs_answer": return 0
    case "blocked": return 1
    case "running": return 2
    case "review_required": return 3
    case "failed": return 4
    case "done": return 9
    default: return 5
  }
}

function runSortWeight(status: string): number {
  switch (status) {
    case "needs_answer": return 0
    case "blocked": return 1
    case "running": return 2
    case "failed": return 3
    case "completed": return 9
    default: return 5
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

function currentRunTerminalCode(repos: Repos, runId: string): number | null {
  const run = repos.getRun(runId)
  if (!run) return null
  if (run.recovery_status === "blocked") return 11
  if (run.recovery_status === "failed" || run.status === "failed") return 10
  if (run.status === "completed") return 0
  return null
}

function listProjectedMessages(
  repos: Repos,
  input: { runId: string; level: MessagingLevel; since?: string; limit: number },
): { entries: MessageEntry[]; nextSince: string | null } {
  const entries: MessageEntry[] = []
  let cursor = input.since
  const batchSize = Math.min(Math.max(input.limit, 1), 500)
  while (entries.length < input.limit) {
    const batch = repos.listLogsForRunAfterId(input.runId, cursor, batchSize)
    if (batch.length === 0) break
    for (const row of batch) {
      const entry = projectStageLogRow(row)
      if (entry && shouldDeliverAtLevel(entry, input.level)) entries.push(entry)
      cursor = row.id
      if (entries.length >= input.limit) break
    }
    if (batch.length < batchSize) break
  }
  return {
    entries,
    nextSince: entries.length === input.limit ? entries[entries.length - 1]?.id ?? null : null,
  }
}

function printMessageEntry(entry: MessageEntry): void {
  console.log(`  ${renderMessageEntry(entry)}`)
}

function emitJsonLine(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function readAnswerBody(opts: { provided?: string; multiline?: boolean }): string {
  if (opts.provided !== undefined) return opts.provided
  const raw = readFileSync(0, "utf8")
  if (opts.multiline) return raw.replace(/\s+$/, "")
  return raw.split(/\r?\n/)[0]?.trim() ?? ""
}

async function isUiReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/", url), { method: "HEAD", signal: AbortSignal.timeout(1500) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

function openBrowser(url: string): void {
  if (process.env.BEERENGINEER_DISABLE_BROWSER_OPEN === "1") return
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

function resolveSelectedWorkspace(repos: Repos, explicit?: string) {
  if (explicit) return repos.getWorkspaceByKey(explicit)
  const remembered = loadCliState().currentWorkspaceKey
  if (remembered) {
    const workspace = repos.getWorkspaceByKey(remembered)
    if (workspace) return workspace
  }
  return repos.listWorkspaces().sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0) || a.key.localeCompare(b.key))[0]
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

function readArtifactJson<T>(repos: Repos, runId: string, stageId: string, fileName: string): T | null {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForRun(repos, run) : null
  if (!ctx) return null
  const path = join(layout.stageArtifactsDir(ctx, stageId), fileName)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function artifactPath(repos: Repos, runId: string, stageId: string, fileName: string): string | null {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForRun(repos, run) : null
  return ctx ? join(layout.stageArtifactsDir(ctx, stageId), fileName) : null
}

export async function runDoctor(options: { json?: boolean; group?: string } = {}): Promise<number> {
  if (options.json) {
    const report = await generateSetupReport({ group: options.group })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.overall === "blocked" ? 1 : 0
  }
  return runDoctorCommand({ group: options.group })
}

function loadEffectiveConfig(): AppConfig | null {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  const state = readConfigFile(configPath)
  return resolveMergedConfig(state, overrides) as AppConfig | null
}

function parseHarnessProfile(input: { profile?: string; profileJson?: string }, config: AppConfig): HarnessProfile {
  if (input.profileJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.profileJson)
    } catch (err) {
      throw new Error(`--profile-json is not valid JSON: ${(err as Error).message}`)
    }
    return validateHarnessProfileShape(parsed)
  }
  switch (input.profile) {
    case undefined:
      return config.llm.defaultHarnessProfile
    case "codex-first":
    case "claude-first":
    case "codex-only":
    case "claude-only":
    case "fast":
    case "claude-sdk-first":
    case "codex-sdk-first":
      return { mode: input.profile }
    default:
      throw new Error(`Unsupported --profile value: ${input.profile}`)
  }
}

function printPreview(preview: Awaited<ReturnType<typeof previewWorkspace>>): void {
  console.log("")
  console.log("  Preview")
  console.log(`    path:             ${preview.path}`)
  console.log(`    exists:           ${preview.exists}`)
  console.log(`    greenfield:       ${preview.isGreenfield}`)
  console.log(`    writable:         ${preview.isWritable}`)
  console.log(`    allowed root:     ${preview.isInsideAllowedRoot}`)
  console.log(`    git repo:         ${preview.isGitRepo}${preview.defaultBranch ? ` (${preview.defaultBranch})` : ""}`)
  console.log(`    registered:       ${preview.isRegistered}`)
  if (preview.detectedStack) console.log(`    detected stack:   ${preview.detectedStack}`)
  if (preview.existingFiles.length > 0) console.log(`    top-level files:  ${preview.existingFiles.join(", ")}`)
  for (const conflict of preview.conflicts) console.log(`    conflict:         ${conflict}`)
  console.log("")
}

async function runWorkspacePreviewCommand(path: string | undefined, json = false): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  if (!path) {
    console.error("  Missing path: beerengineer workspace preview <path>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const preview = await previewWorkspace(path, config, repos)
    if (json) process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`)
    else printPreview(preview)
    return preview.conflicts.length > 0 ? 1 : 0
  } finally {
    db.close()
  }
}

async function runWorkspaceAddCommand(cmd: Extract<Command, { kind: "workspace-add" }>): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }

  let addInput: RegisterWorkspaceInput
  try {
    if (!cmd.path && !cmd.noInteractive && process.stdin.isTTY && process.stdout.isTTY) {
      const prompted = await promptForWorkspaceAddDefaults(config)
      addInput = {
        path: prompted.path,
        name: prompted.name,
        key: prompted.key,
        harnessProfile: prompted.profile,
        sonar: prompted.sonar,
        git: { init: prompted.gitInit, defaultBranch: "main" },
        github: prompted.github,
        sonarToken: prompted.sonarToken,
      }
    } else {
      if (!cmd.path) {
        console.error("  Missing --path for non-interactive workspace add.")
        return 2
      }
      addInput = {
        path: cmd.path,
        name: cmd.name,
        key: cmd.key,
        harnessProfile: parseHarnessProfile(cmd, config),
        sonar: cmd.sonar
          ? {
              enabled: true,
              projectKey: cmd.sonarKey,
              organization: cmd.sonarOrg,
              hostUrl: cmd.sonarHost,
            }
          : { enabled: false },
        git: { init: cmd.noGit !== true, defaultBranch: "main" },
        github: cmd.ghCreate
          ? { create: true, visibility: cmd.ghPublic ? "public" : "private", owner: cmd.ghOwner }
          : undefined,
        sonarToken: cmd.sonarToken
          ? { value: cmd.sonarToken, persist: cmd.sonarTokenPersist !== false }
          : undefined,
      }
    }
  } catch (err) {
    console.error(`  ${(err as Error).message}`)
    return 2
  }

  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const appReport = await generateSetupReport({ allLlmGroups: true })
    const result = await registerWorkspace(addInput, { repos, config, appReport })
    if (cmd.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) {
      console.error(`  ${result.error}: ${result.detail}`)
      return 1
    }
    for (const action of result.actions) console.log(`  ${action}`)
    for (const warning of result.warnings) console.log(`  ! ${warning}`)
    console.log(`\n  Registered as "${result.workspace.name}" (key: ${result.workspace.key}).`)
    if (result.sonarProjectUrl) {
      console.log("\n  Next steps")
      console.log("    SonarQube Cloud")
      console.log(`    1. Create or import the project in SonarQube Cloud: ${result.sonarProjectUrl}`)
      console.log("    2. Check whether your org uses the EU default or the US region.")
      console.log("    3. Create an analysis token and export it locally: export SONAR_TOKEN=...")
      console.log("    4. Mark the project as AI-generated: Project settings > AI-generated code >")
      console.log("       enable \"Contains AI-generated code\" (adds the +Contains AI code label).")
      console.log("    5. Apply an AI-qualified quality gate: Project settings > Quality Gate >")
      console.log("       select \"Sonar way for AI Code\" (or a custom gate qualified for AI Code")
      console.log("       Assurance by a Quality Standard admin).")
      console.log("    6. Disable automatic analysis: Administration > Analysis Method > uncheck")
      console.log("       \"Enabled for this project\" so only the local sonar-scanner runs.")
      console.log("    7. Keep durable analysis settings in the SonarQube Cloud UI when possible.")
      console.log("    8. If the project is on the US region, set sonar.region=us for scanner runs.")
      if (result.sonarMcpSnippet) {
        console.log("    9. Optional: add Sonar MCP to your harness config:")
        console.log(`\n${indentBlock(result.sonarMcpSnippet, 6)}`)
      }
    } else if (result.ghCreateCommand) {
      console.log("\n  Next steps")
    }
    if (result.sonarProjectUrl || result.ghCreateCommand) {
      console.log("    CodeRabbit")
      console.log("    - Optional: install the CLI with npm i -g @coderabbit/cli")
      console.log("    - Authenticate it per the CodeRabbit CLI docs before enabling real review runs")
      console.log("    - If it is not configured, BeerEngineer will skip CodeRabbit review for the workspace")
    }
    if (result.ghCreateCommand) console.log(`    Optional remote: ${result.ghCreateCommand}`)
    console.log(`    Open: beerengineer workspace open ${result.workspace.key}`)
    return 0
  } finally {
    db.close()
  }
}

function indentBlock(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces)
  return text
    .split("\n")
    .map(line => `${prefix}${line}`)
    .join("\n")
}

async function runWorkspaceListCommand(json = false): Promise<number> {
  const db = initDatabase()
  try {
    const rows = listRegisteredWorkspaces(new Repos(db))
    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return 0
    }
    if (rows.length === 0) {
      console.log("  No workspaces registered.")
      return 0
    }
    for (const row of rows) {
      console.log(`  ${row.key}  ${row.rootPath}`)
    }
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceGetCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace get <key>")
    return 2
  }
  const db = initDatabase()
  try {
    const workspace = getRegisteredWorkspace(new Repos(db), key)
    if (!workspace) return 1
    if (json) process.stdout.write(`${JSON.stringify(workspace, null, 2)}\n`)
    else console.log(`  ${workspace.key}  ${workspace.rootPath}`)
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceRemoveCommand(
  key: string | undefined,
  purge = false,
  json = false,
  yes = false,
  noInteractive = false,
): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace remove <key>")
    return 2
  }
  // Only load config when purge is requested. Non-purge removal doesn't touch
  // the filesystem so it should keep working even if the config is missing.
  const config = purge ? loadEffectiveConfig() : null
  if (purge && !config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    if (purge && !yes) {
      const workspace = getRegisteredWorkspace(repos, key)
      const targetPath = workspace?.rootPath ?? "(unknown path)"
      const interactive = !noInteractive && !json && process.stdin.isTTY && process.stdout.isTTY
      if (!interactive) {
        const message = `Refusing to purge workspace ${key} (${targetPath}) without --yes in non-interactive mode.`
        if (json) {
          process.stdout.write(`${JSON.stringify({ ok: false, error: "confirmation_required", detail: message }, null, 2)}\n`)
        } else {
          console.error(`  ${message}`)
          console.error(`  Re-run with: beerengineer workspace remove ${key} --purge --yes`)
        }
        return 2
      }
      const answer = await ask(`  About to rm -rf ${targetPath}. This cannot be undone. Type 'yes' to confirm: `)
      close()
      if (answer.trim().toLowerCase() !== "yes") {
        console.log("  Purge cancelled.")
        return 1
      }
    }
    const result = await removeWorkspace(repos, key, {
      purge,
      allowedRoots: config?.allowedRoots,
    })
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) return 1
    if (result.purgeSkipped) {
      console.log(`  Removed workspace ${key} (purge skipped: ${result.purgeSkipped.reason} for ${result.purgeSkipped.path})`)
    } else {
      console.log(`  Removed workspace ${key}${purge && result.purgedPath ? ` and purged ${result.purgedPath}` : ""}`)
    }
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceOpenCommand(key: string | undefined): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace open <key>")
    return 2
  }
  const db = initDatabase()
  try {
    const rootPath = openWorkspace(new Repos(db), key)
    if (!rootPath) return 1
    process.stdout.write(`${rootPath}\n`)
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceUseCommand(key: string | undefined): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace use <key>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = repos.getWorkspaceByKey(key)
    if (!workspace) {
      console.error(`  Workspace not found: ${key}`)
      return 1
    }
    repos.touchWorkspaceLastOpenedAt(key)
    saveCliState({ currentWorkspaceKey: key })
    console.log(`  Current workspace: ${key}`)
    return 0
  } finally {
    db.close()
  }
}

function printItemRows(
  rows: Array<{ workspaceKey?: string; code: string; title: string; stage: string; status: string }>,
  compact = false,
): void {
  if (compact) {
    console.log("  workspace  item      title                           stage/status")
    rows.forEach(row => {
      console.log(`  ${(row.workspaceKey ?? "").padEnd(9)} ${row.code} ${truncate(row.title, 60)}  ${row.stage} / ${row.status}`)
    })
    return
  }
  rows.forEach(row => {
    const prefix = row.workspaceKey ? `${row.workspaceKey}  ` : ""
    console.log(`  ${prefix}${row.code}  ${row.title}`)
    console.log(`    ${row.stage} / ${row.status}`)
  })
}

async function runItemsCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const selectedWorkspace = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
    const workspaces = all ? repos.listWorkspaces() : selectedWorkspace ? [selectedWorkspace] : []
    if (workspaces.length === 0) {
      console.error("  No workspace selected.")
      return 1
    }
    const rows = workspaces.flatMap(workspace => {
      const promptsByRun = new Map(repos.listOpenPrompts({ workspaceId: workspace.id }).map(prompt => [prompt.run_id, prompt]))
      return repos.listItemsForWorkspace(workspace.id).map(item => {
        const latestRun = latestRunForItem(repos, item.id)
        const prompt = latestRun ? promptsByRun.get(latestRun.id) : undefined
        return {
          workspaceKey: all ? workspace.key : undefined,
          code: item.code,
          title: item.title,
          stage: latestRun?.current_stage ?? item.current_column,
          status: deriveItemStatus(item, latestRun, Boolean(prompt)),
          sortCreatedAt: item.created_at,
        }
      })
    }).sort((a, b) => itemSortWeight(a.status) - itemSortWeight(b.status) || a.sortCreatedAt - b.sortCreatedAt)

    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return 0
    }
    console.log(all ? "  Items across all workspaces" : `  Items for workspace ${workspaces[0]!.key}`)
    printItemRows(rows, compact)
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceItemsCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace items <key>")
    return 2
  }
  return runItemsCommand(key, false, json, false)
}

function printChatRows(
  rows: Array<{ workspaceKey?: string; itemCode: string; itemTitle: string; stage: string; status: string; prompt: string; runId: string }>,
  compact = false,
): void {
  if (compact) {
    console.log("  workspace  item      title                           stage/status             prompt")
    rows.forEach(row => {
      console.log(`  ${(row.workspaceKey ?? "").padEnd(9)} ${row.itemCode} ${truncate(row.itemTitle, 60)}  ${`${row.stage} / ${row.status}`.padEnd(24)}  ${truncate(row.prompt, 70)}`)
    })
    return
  }
  rows.forEach(row => {
    const prefix = row.workspaceKey ? `${row.workspaceKey}  ` : ""
    console.log(`  ${prefix}${row.itemCode}  ${row.itemTitle}`)
    console.log(`    ${row.stage} / ${row.status}`)
    console.log(`    prompt: ${row.prompt}`)
    console.log(`    run: ${row.runId}`)
    const lastAnswer = row.runId ? null : null
    void lastAnswer
  })
}

async function runChatListCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = all ? undefined : resolveSelectedWorkspace(repos, workspaceKey)
    const prompts = repos.listOpenPrompts(workspace ? { workspaceId: workspace.id } : {})
    const rows = prompts.map(prompt => ({
      workspaceKey: prompt.workspace_key,
      itemCode: prompt.item_code,
      itemTitle: prompt.item_title,
      stage: prompt.current_stage ?? "—",
      status: "needs_answer",
      prompt: promptDisplayText(repos, prompt),
      runId: prompt.run_id,
      createdAt: prompt.created_at,
    })).sort((a, b) => a.createdAt - b.createdAt)

    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return 0
    }
    console.log(all ? "  Open chats across all workspaces" : `  Open chats for workspace ${workspace?.key ?? "—"}`)
    printChatRows(rows, compact)
    return 0
  } finally {
    db.close()
  }
}

function gitState(rootPath: string | null): string {
  if (!rootPath) return "none"
  const inspection = inspectWorkspaceState(rootPath)
  switch (inspection.kind) {
    case "not-a-repo":
      return "none"
    case "git-status-failed":
      return "unknown"
    case "ok":
      return `${inspection.currentBranch} / clean`
    case "dirty":
      return `${inspection.currentBranch} / dirty`
  }
}

async function runStatusCommand(workspaceKey: string | undefined, all = false, json = false): Promise<number> {
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    if (all) {
      const workspaces = repos.listWorkspaces()
      const promptRows = repos.listOpenPrompts()
      const rows = workspaces.map(workspace => {
        const items = repos.listItemsForWorkspace(workspace.id)
        const runs = repos.listRuns().filter(run => run.workspace_id === workspace.id)
        const chats = promptRows.filter(prompt => prompt.workspace_id === workspace.id)
        const latestRun = runs.sort((a, b) => b.created_at - a.created_at)[0]
        const state =
          chats.length > 0 ? "needs_answer" :
          runs.some(run => run.recovery_status === "blocked") ? "blocked" :
          runs.some(run => run.status === "running") ? "running" :
          "idle"
        return {
          workspace: workspace.key,
          state,
          itemCount: items.length,
          runCount: runs.length,
          chatCount: chats.length,
          latest: latestRun ? `${latestRun.current_stage ?? "—"} / run/${shortRunId(latestRun.id)}` : "idle",
        }
      }).sort((a, b) => itemSortWeight(a.state) - itemSortWeight(b.state) || a.workspace.localeCompare(b.workspace))
      if (json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
        return 0
      }
      console.log("  Status across all workspaces")
      console.log(`  counts: workspaces=${workspaces.length} items=${workspaces.reduce((sum, w) => sum + repos.listItemsForWorkspace(w.id).length, 0)} runs=${repos.listRuns().length} chats=${promptRows.length}`)
      rows.forEach(row => {
        console.log(`  ${row.workspace.padEnd(8)}  ${row.state.padEnd(12)}  i=${row.itemCount} r=${row.runCount} c=${row.chatCount}  ${row.latest}`)
      })
      return 0
    }

    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) {
      console.error("  No workspace selected.")
      return 1
    }
    const items = repos.listItemsForWorkspace(workspace.id)
    const runs = repos.listRuns().filter(run => run.workspace_id === workspace.id)
    const openPrompts = repos.listOpenPrompts({ workspaceId: workspace.id })
    const latestRun = runs.sort((a, b) => b.created_at - a.created_at)[0]
    const state =
      openPrompts.length > 0 ? "needs_answer" :
      runs.some(run => run.recovery_status === "blocked") ? "blocked" :
      runs.some(run => run.status === "running") ? "running" :
      "idle"
    if (json) {
      process.stdout.write(`${JSON.stringify({ workspace: workspace.key, state, itemCount: items.length, runCount: runs.length, chatCount: openPrompts.length }, null, 2)}\n`)
      return 0
    }
    console.log(`  Workspace ${workspace.key}`)
    console.log(`  state: ${state}`)
    console.log(`  root: ${workspace.root_path ?? "—"}`)
    console.log(`  git: ${gitState(workspace.root_path)}`)
    console.log(`  counts: items=${items.length} runs=${runs.length} chats=${openPrompts.length}`)
    if (latestRun) console.log(`  latest run: run/${shortRunId(latestRun.id)} / ${latestRun.current_stage ?? "—"} / ${deriveRunStatus(latestRun, openPrompts.some(prompt => prompt.run_id === latestRun.id))}`)
    return 0
  } finally {
    db.close()
  }
}

async function runItemGetCommand(itemRef: string | undefined, workspaceKey: string | undefined, json = false): Promise<number> {
  if (!itemRef) {
    console.error("  Missing item reference: beerengineer item get <id|code>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 1
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (!item) {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    const latestRun = latestRunForItem(repos, item.id)
    const prompt = latestRun ? repos.getOpenPrompt(latestRun.id) : undefined
    const status = deriveItemStatus(item, latestRun, Boolean(prompt))
    const openChat = prompt ? promptDisplayText(repos, prompt) : null
    if (json) {
      process.stdout.write(`${JSON.stringify({ item, workspace: workspace.key, latestRun, status, openChat }, null, 2)}\n`)
      return 0
    }
    console.log(`  ${item.code}  ${item.title}`)
    console.log(`  workspace: ${workspace.key}`)
    console.log(`  stage/status: ${latestRun?.current_stage ?? item.current_column} / ${status}`)
    if (latestRun) console.log(`  run: ${latestRun.id} (${latestRun.status})`)
    if (openChat) console.log(`  open chat: ${openChat}`)
    return 0
  } finally {
    db.close()
  }
}

async function runItemWireframesCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  open = false,
  json = false,
): Promise<number> {
  if (!itemRef) {
    console.error("  Missing item reference: beerengineer item wireframes <id|code>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 2
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (!item) {
      const payload = { ok: false, code: 2, reason: `item not found: ${itemRef}` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  Item not found: ${itemRef}`)
      return 2
    }
    const run = latestCompletedRunForItem(repos, item.id)
    if (!run) {
      const payload = { ok: false, code: 3, reason: `no completed run for ${item.code}` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  no completed run for ${item.code}`)
      return 3
    }
    const artifact = readArtifactJson<WireframeArtifact>(repos, run.id, "visual-companion", "wireframes.json")
    if (!artifact) {
      const payload = { ok: false, code: 3, reason: `no design-prep artifacts for ${item.code} (hasUi=false)` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  no design-prep artifacts for ${item.code} (hasUi=false)`)
      return 3
    }
    const screenMapPath = artifactPath(repos, run.id, "visual-companion", "screen-map.html")
    if (json) {
      process.stdout.write(`${JSON.stringify({
        itemId: item.id,
        runId: run.id,
        screenCount: artifact.screens.length,
        screenMapPath,
        screens: artifact.screens.map(screen => ({
          id: screen.id,
          name: screen.name,
          projectIds: screen.projectIds,
          path: artifactPath(repos, run.id, "visual-companion", `${screen.id}.html`),
        })),
      })}\n`)
      if (open) openBrowser(`file://${screenMapPath}`)
      return 0
    }
    console.log("  screen  projects  purpose  file")
    artifact.screens.forEach(screen => {
      console.log(`  ${screen.id}  ${screen.projectIds.join(",")}  ${truncate(screen.purpose, 30)}  ${artifactPath(repos, run.id, "visual-companion", `${screen.id}.html`)}`)
    })
    console.log(`  screen-map: ${screenMapPath}`)
    if (open) openBrowser(`file://${screenMapPath}`)
    return 0
  } finally {
    db.close()
  }
}

async function runItemDesignCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  open = false,
  json = false,
): Promise<number> {
  if (!itemRef) {
    console.error("  Missing item reference: beerengineer item design <id|code>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 2
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (!item) {
      const payload = { ok: false, code: 2, reason: `item not found: ${itemRef}` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  Item not found: ${itemRef}`)
      return 2
    }
    const run = latestCompletedRunForItem(repos, item.id)
    if (!run) {
      const payload = { ok: false, code: 3, reason: `no completed run for ${item.code}` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  no completed run for ${item.code}`)
      return 3
    }
    const artifact = readArtifactJson<DesignArtifact>(repos, run.id, "frontend-design", "design.json")
    if (!artifact) {
      const payload = { ok: false, code: 3, reason: `no design-prep artifacts for ${item.code} (hasUi=false)` }
      if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else console.error(`  no design-prep artifacts for ${item.code} (hasUi=false)`)
      return 3
    }
    const previewPath = artifactPath(repos, run.id, "frontend-design", "design-preview.html")
    if (json) {
      process.stdout.write(`${JSON.stringify({ itemId: item.id, runId: run.id, ...artifact, previewPath })}\n`)
      if (open) openBrowser(`file://${previewPath}`)
      return 0
    }
    console.log(`  tone: ${artifact.tone}`)
    console.log(`  light.primary: ${artifact.tokens.light.primary}`)
    console.log(`  light.accent: ${artifact.tokens.light.accent}`)
    console.log(`  display: ${artifact.typography.display.family}`)
    console.log(`  body: ${artifact.typography.body.family}`)
    console.log(`  spacing.baseUnit: ${artifact.spacing.baseUnit}`)
    console.log(`  design-preview: ${previewPath}`)
    if (open) openBrowser(`file://${previewPath}`)
    return 0
  } finally {
    db.close()
  }
}

async function runRunListCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspaces = new Map(repos.listWorkspaces().map(workspace => [workspace.id, workspace]))
    const selected = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
    const prompts = repos.listOpenPrompts(selected ? { workspaceId: selected.id } : {})
    const promptRunIds = new Set(prompts.map(prompt => prompt.run_id))
    const items = new Map(
      (selected ? repos.listItemsForWorkspace(selected.id) : Array.from(workspaces.keys()).flatMap(id => repos.listItemsForWorkspace(id)))
        .map(item => [item.id, item])
    )
    const rows = repos.listRuns()
      .filter(run => all || run.workspace_id === selected?.id)
      .map(run => ({
        workspaceKey: all ? workspaces.get(run.workspace_id)?.key ?? "—" : undefined,
        runId: shortRunId(run.id),
        itemCode: items.get(run.item_id)?.code ?? "—",
        itemTitle: items.get(run.item_id)?.title ?? run.title,
        stage: run.current_stage ?? "—",
        status: deriveRunStatus(run, promptRunIds.has(run.id)),
        owner: run.owner,
        sortCreatedAt: run.created_at,
      }))
      .sort((a, b) => runSortWeight(a.status) - runSortWeight(b.status) || b.sortCreatedAt - a.sortCreatedAt)
    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return 0
    }
    console.log(all ? "  Runs across all workspaces" : `  Runs for workspace ${selected?.key ?? "—"}`)
    if (compact) {
      console.log("  workspace  run       item      title                           stage/status/owner")
      rows.forEach(row => {
        console.log(`  ${(row.workspaceKey ?? "").padEnd(9)} ${row.runId} ${row.itemCode} ${truncate(row.itemTitle ?? "—", 60)}  ${row.stage} / ${row.status} / ${row.owner}`)
      })
      return 0
    }
    rows.forEach(row => {
      const prefix = row.workspaceKey ? `${row.workspaceKey}  ` : ""
      console.log(`  ${prefix}run/${row.runId}  ${row.itemCode}  ${row.itemTitle}`)
      console.log(`    ${row.stage} / ${row.status} / ${row.owner}`)
    })
    return 0
  } finally {
    db.close()
  }
}

async function runRunGetCommand(runId: string | undefined, json = false): Promise<number> {
  if (!runId) {
    console.error("  Missing run id: beerengineer run get <run-id>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const run = repos.getRun(runId)
    if (!run) {
      console.error(`  Run not found: ${runId}`)
      return 1
    }
    const workspace = repos.getWorkspace(run.workspace_id)
    const item = repos.getItem(run.item_id)
    const prompt = repos.getOpenPrompt(run.id)
    const openChat = prompt ? promptDisplayText(repos, prompt) : null
    const payload = {
      run,
      workspaceKey: workspace?.key ?? null,
      itemCode: item?.code ?? null,
      itemTitle: item?.title ?? null,
      openChat,
      artifactCount: repos.listArtifactsForRun(run.id).length,
      stageRunCount: repos.listStageRunsForRun(run.id).length,
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      return 0
    }
    console.log(`  ${run.id}`)
    console.log(`  workspace: ${workspace?.key ?? "—"}`)
    console.log(`  item: ${item?.code ?? "—"}  ${item?.title ?? "—"}`)
    console.log(`  stage/status: ${run.current_stage ?? "—"} / ${deriveRunStatus(run, Boolean(prompt))}`)
    if (openChat) console.log(`  open chat: ${openChat}`)
    console.log(`  stage runs: ${payload.stageRunCount}`)
    console.log(`  artifacts: ${payload.artifactCount}`)
    return 0
  } finally {
    db.close()
  }
}

async function runChatAnswerCommand(cmd: Extract<Command, { kind: "chat-answer" }>): Promise<number> {
  const { recordAnswer } = await import("./core/conversation.js")
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const prompt =
      cmd.promptId ? repos.getPendingPrompt(cmd.promptId) :
      cmd.runId ? repos.getOpenPrompt(cmd.runId) :
      undefined
    if (!prompt || prompt.answered_at) {
      console.error("  Open prompt not found.")
      return EXIT_USAGE
    }
    const answer = readAnswerBody({ provided: cmd.answer, multiline: cmd.multiline })
    const result = recordAnswer(repos, {
      runId: prompt.run_id,
      promptId: prompt.id,
      answer,
      source: "cli",
    })
    if (!result.ok) {
      console.error(`  Could not record answer: ${result.code}`)
      return EXIT_USAGE
    }
    if (cmd.json) {
      process.stdout.write(`${JSON.stringify(result.conversation, null, 2)}\n`)
      return 0
    }
    console.log(`  answered ${prompt.id}`)
    console.log(`  run: ${prompt.run_id}`)
    if (cmd.runId) console.log("  target: latest open prompt for run")
    return 0
  } finally {
    db.close()
  }
}

async function runChatSendCommand(cmd: Extract<Command, { kind: "chat-send" }>): Promise<number> {
  const { recordUserMessage } = await import("./core/conversation.js")
  if (!cmd.runId || !cmd.text) {
    console.error("  Usage: beerengineer chat send <run-id> <text>")
    return EXIT_USAGE
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const result = recordUserMessage(repos, {
      runId: cmd.runId,
      text: cmd.text,
      source: "cli",
    })
    if (!result.ok) {
      console.error(`  Could not send message: ${result.code}`)
      return EXIT_USAGE
    }
    const entry = projectStageLogRow(repos.listLogsForRun(cmd.runId).find(row => row.id === result.entryId)!)
    if (cmd.json) {
      process.stdout.write(`${JSON.stringify(entry ?? { id: result.entryId, runId: cmd.runId }, null, 2)}\n`)
      return 0
    }
    console.log(`  sent ${result.entryId}`)
    console.log(`  run: ${cmd.runId}`)
    return 0
  } finally {
    db.close()
  }
}

async function runRunMessagesCommand(cmd: Extract<Command, { kind: "run-messages" }>): Promise<number> {
  if (!cmd.runId) {
    console.error("  Missing run id: beerengineer runs messages <run-id>")
    return EXIT_USAGE
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const run = repos.getRun(cmd.runId)
    if (!run) {
      console.error(`  Run not found: ${cmd.runId}`)
      return 1
    }
    const result = listProjectedMessages(repos, {
      runId: cmd.runId,
      level: cmd.level,
      since: cmd.since,
      limit: cmd.limit,
    })
    if (cmd.json) {
      process.stdout.write(`${JSON.stringify({ runId: cmd.runId, schema: "messages-v1", nextSince: result.nextSince, entries: result.entries }, null, 2)}\n`)
      return 0
    }
    console.log(`  messages ${run.id}  ${run.title}`)
    result.entries.forEach(printMessageEntry)
    return 0
  } finally {
    db.close()
  }
}

async function runRunTailCommand(cmd: Extract<Command, { kind: "run-tail" }>): Promise<number> {
  if (!cmd.runId) {
    console.error("  Missing run id: beerengineer runs tail <run-id>")
    return EXIT_USAGE
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const run = repos.getRun(cmd.runId)
    if (!run) {
      console.error(`  Run not found: ${cmd.runId}`)
      return 1
    }
    const sinceId =
      cmd.since ??
      repos.listLogsForRunAfterCursor(cmd.runId, 0).slice(-1)[0]?.id ??
      undefined

    return await new Promise<number>((resolve) => {
      let resolved = false
      const finish = (code: number): void => {
        if (resolved) return
        resolved = true
        tail.stop()
        resolve(code)
      }
      const tail = tailStageLogs(repos, { scope: { kind: "run", runId: cmd.runId! }, sinceId }, row => {
        const entry = projectStageLogRow(row)
        if (!entry || !shouldDeliverAtLevel(entry, cmd.level)) return
        if (cmd.json) emitJsonLine(entry)
        else printMessageEntry(entry)
        const exitCode = terminalExitCodeForEntry(entry)
        if (exitCode !== null) finish(exitCode)
      })
      tail.pollOnce()

      const terminal = currentRunTerminalCode(repos, cmd.runId!)
      if (terminal !== null && !resolved) finish(terminal)
    })
  } finally {
    db.close()
  }
}

async function runRunWatchCommand(cmd: Extract<Command, { kind: "run-watch" }>): Promise<number> {
  const runId = cmd.runId
  if (!runId) {
    console.error("  Missing run id: beerengineer runs watch <run-id>")
    return EXIT_USAGE
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const run = repos.getRun(runId)
    if (!run) {
      console.error(`  Run not found: ${runId}`)
      return 1
    }
    if (!cmd.json) console.log(`  watching ${run.id}  ${run.title}`)
    const result = listProjectedMessages(repos, {
      runId,
      level: cmd.level,
      since: cmd.since,
      limit: Number.MAX_SAFE_INTEGER,
    })
    for (const entry of result.entries) {
      if (cmd.json) emitJsonLine(entry)
      else printMessageEntry(entry)
    }
    const terminalFromHistory = result.entries.map(terminalExitCodeForEntry).find(code => code !== null)
    if (terminalFromHistory !== undefined) {
      if (!cmd.json) {
        const refreshed = repos.getRun(run.id)
        console.log(`  done  ${refreshed?.current_stage ?? "—"} / ${refreshed?.status ?? "unknown"}`)
      }
      return terminalFromHistory ?? 0
    }
    const tailCode = await runRunTailCommand({
      kind: "run-tail",
      runId,
      level: cmd.level,
      since: result.entries.at(-1)?.id ?? cmd.since,
      json: cmd.json,
    })
    if (!cmd.json) {
      const refreshed = repos.getRun(run.id)
      console.log(`  done  ${refreshed?.current_stage ?? "—"} / ${refreshed?.status ?? "unknown"}`)
    }
    return tailCode
  } finally {
    db.close()
  }
}

function resolvePublicBaseUrl(): string {
  return loadEffectiveConfig()?.publicBaseUrl?.trim() || resolveUiLaunchUrl()
}

function resolveCliItem(
  repos: Repos,
  itemRef: string,
  workspaceKey?: string,
): { item: ItemRow; workspaceKey?: string } | null {
  if (workspaceKey) {
    const workspace = repos.getWorkspaceByKey(workspaceKey)
    if (!workspace) return null
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (!item || item.workspace_id !== workspace.id) return null
    return { item, workspaceKey: workspace.key }
  }
  const direct = repos.getItem(itemRef)
  if (direct) {
    const workspace = repos.getWorkspace(direct.workspace_id)
    return { item: direct, workspaceKey: workspace?.key }
  }
  const byCode = repos.findItemsByCode(itemRef)
  if (byCode.length !== 1) return null
  const workspace = repos.getWorkspace(byCode[0].workspace_id)
  return { item: byCode[0], workspaceKey: workspace?.key }
}

async function runItemOpenCommand(itemRef: string | undefined, workspaceKey: string | undefined): Promise<number> {
  if (!itemRef) {
    console.error("  Missing item reference: beerengineer item open <id|code>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 1
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (!item) {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    const url = `${resolvePublicBaseUrl()}/?workspace=${encodeURIComponent(workspace.key)}&item=${encodeURIComponent(item.code)}`
    console.log(`  ${url}`)
    if (await isUiReachable(url)) openBrowser(url)
    else console.log("  UI is not reachable on that address; printed URL only.")
    return 0
  } finally {
    db.close()
  }
}

async function runItemPreviewCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  opts: { start?: boolean; open?: boolean; json?: boolean },
): Promise<number> {
  if (!itemRef) {
    console.error("  Missing item reference: beerengineer item preview <id|code>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const resolved = resolveCliItem(repos, itemRef, workspaceKey)
    if (!resolved) {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    const preview = resolveItemPreviewContext(repos, resolved.item.id)
    if (!preview.ok) {
      console.error(`  ${preview.error}`)
      return 1
    }
    const launch = resolvePreviewLaunchSpec(preview.worktreePath)
    let status: "started" | "already_running" | "stopped" = "stopped"
    let logPath: string | undefined
    if (opts.start) {
      try {
        const started = await startPreviewServer(preview)
        status = started.status
        logPath = started.logPath
      } catch (error) {
        console.error(`  ${(error as Error).message}`)
        return 1
      }
    } else {
      status = (await isPortListening(preview.previewHost, preview.previewPort)) ? "already_running" : "stopped"
    }

    const payload = {
      itemId: resolved.item.id,
      workspaceKey: resolved.workspaceKey,
      branch: preview.branch,
      worktreePath: preview.worktreePath,
      previewHost: preview.previewHost,
      previewPort: preview.previewPort,
      previewUrl: preview.previewUrl,
      status,
      launch: launch
        ? {
            command: launch.command,
            cwd: launch.cwd,
            source: launch.source,
          }
        : null,
      logPath: logPath ?? join(preview.worktreePath, ".beerengineer-preview.log"),
    }
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    } else {
      console.log(`  branch:       ${payload.branch}`)
      console.log(`  worktree:     ${payload.worktreePath}`)
      console.log(`  preview:      ${payload.previewUrl}`)
      console.log(`  status:       ${payload.status}`)
      if (payload.launch) {
        console.log(`  command:      ${payload.launch.command}`)
        console.log(`  command cwd:  ${payload.launch.cwd}`)
        console.log(`  source:       ${payload.launch.source}`)
      } else {
        console.log("  command:      not configured")
        console.log("  hint:         add .beerengineer/workspace.json -> preview.command or a root package.json dev script")
      }
      console.log(`  log:          ${payload.logPath}`)
    }
    if (opts.open) openBrowser(preview.previewUrl)
    return 0
  } finally {
    db.close()
  }
}

async function runRunOpenCommand(runId: string | undefined): Promise<number> {
  if (!runId) {
    console.error("  Missing run id: beerengineer run open <run-id>")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    if (!repos.getRun(runId)) {
      console.error(`  Run not found: ${runId}`)
      return 1
    }
    const url = `${resolvePublicBaseUrl()}/runs/${encodeURIComponent(runId)}`
    console.log(`  ${url}`)
    if (await isUiReachable(url)) openBrowser(url)
    else console.log("  UI is not reachable on that address; printed URL only.")
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceBackfillCommand(json = false): Promise<number> {
  const db = initDatabase()
  try {
    const result = await backfillWorkspaceConfigs(new Repos(db))
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }
    for (const key of result.written) console.log(`  wrote config for ${key}`)
    for (const skipped of result.skipped) console.log(`  skipped ${skipped.key}: ${skipped.reason}`)
    return 0
  } finally {
    db.close()
  }
}

async function runWorkspaceWorktreeGcCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace gc-worktrees <key>")
    return 2
  }

  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const workspace = getRegisteredWorkspace(repos, key)
    const rootPath = workspace?.rootPath?.trim()
    if (!rootPath) {
      console.error(`  Workspace not found or has no root path: ${key}`)
      return 1
    }

    const gcContext = {
      workspaceId: "gc",
      runId: "gc",
      itemSlug: "gc",
      baseBranch: "main",
      workspaceRoot: rootPath,
    }
    // GC uses the workspace root for worktree listing/removal regardless of
    // whether the repo is clean or dirty; synthesise an enabled mode directly
    // so we do not depend on detectGitMode's dirty-repo gate.
    const git = createGitAdapterFromMode(gcContext, {
      enabled: true,
      workspaceRoot: rootPath,
      baseBranch: "main",
      itemWorktreeRoot: rootPath,
    })
    const result = git.gcManagedStoryWorktrees(layout.worktreesRoot(rootPath))

    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      console.log(`  Removed worktrees: ${result.removed.length}`)
      result.removed.forEach(path => console.log(`    removed ${path}`))
      console.log(`  Kept worktrees: ${result.kept.length}`)
      result.kept.forEach(entry => console.log(`    kept ${entry.path} (${entry.reason})`))
    }
    return 0
  } finally {
    db.close()
  }
}

async function runNotificationsTestCommand(channel: "telegram"): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  if (channel !== "telegram") {
    console.error(`  Unsupported notification channel: ${channel}`)
    return 2
  }
  const db = initDatabase()
  const repos = new Repos(db)
  const result = await sendTelegramTestNotification(config, repos)
  db.close()
  if (!result.ok) {
    console.error(`  Telegram test failed: ${result.error}`)
    return 1
  }
  console.log("  Telegram test notification sent.")
  return 0
}

export function startUi(): Promise<number> {
  const uiDir = resolveUiWorkspacePath()
  if (!existsSync(resolve(uiDir, "package.json"))) {
    console.error("  UI is not currently part of this repo (apps/ui was removed 2026-04-24).")
    console.error("  See specs/ui-rebuild-plan.md — a fresh UI is pending a separate plan.")
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
    const forceTimer = (): void => {
      setTimeout(() => child.kill("SIGKILL"), 1500).unref?.()
    }
    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal)
      forceTimer()
    }
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

export function startEngine(): Promise<number> {
  const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "api", "server.ts")
  console.log(`  Starting engine API from ${serverEntry}`)
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    stdio: "inherit",
    env: process.env,
  })

  return new Promise((resolvePromise) => {
    const forceTimer = (): void => {
      setTimeout(() => child.kill("SIGKILL"), 1500).unref?.()
    }
    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal)
      forceTimer()
    }
    const cleanup = () => {
      process.off("SIGINT", forward)
      process.off("SIGTERM", forward)
    }
    process.on("SIGINT", forward)
    process.on("SIGTERM", forward)
    child.on("exit", code => {
      cleanup()
      resolvePromise(code ?? 0)
    })
    child.on("error", err => {
      cleanup()
      console.error(`  Failed to start engine: ${err.message}`)
      resolvePromise(1)
    })
  })
}

async function runInteractiveWorkflow(opts: { json?: boolean; workspaceKey?: string } = {}): Promise<void> {
  if (opts.json) {
    return runJsonWorkflow({ workspaceKey: opts.workspaceKey })
  }

  console.log("\n  ╔══════════════════════════════════════════════════╗")
  console.log("  ║   beerengineer_                                  ║")
  console.log("  ║   Hand me an idea. Hold your beer.               ║")
  console.log("  ╚══════════════════════════════════════════════════╝\n")

  // Collect the idea *before* we enter the workflow IO scope — `ask()` is used
  // by the orchestrator for mid-run prompts and would otherwise try to persist
  // these intake lines as pending_prompts against a run that doesn't exist yet.
  const title = await ask("  Idea (title):        ")
  const description = await ask("  Idea (description):  ")

  const db = initDatabase()
  const repos = new Repos(db)
  const io = createCliIO(repos)

  try {
    const workspaceMeta = resolveWorkspaceMeta(repos, opts.workspaceKey)
    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli", ...workspaceMeta }
    )
    console.log(`\n  run-id: ${runId}`)
  } finally {
    io.close?.()
    close()
    db.close()
  }
}

function resolveWorkspaceMeta(
  repos: Repos,
  workspaceKey: string | undefined,
): { workspaceKey?: string; workspaceName?: string } {
  if (!workspaceKey) return {}
  const workspace = getRegisteredWorkspace(repos, workspaceKey)
  if (!workspace) throw new Error(`Unknown workspace: ${workspaceKey}`)
  return { workspaceKey: workspace.key, workspaceName: workspace.name }
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
async function runJsonWorkflow(opts: { workspaceKey?: string } = {}): Promise<void> {
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

    const workspaceMeta = resolveWorkspaceMeta(repos, opts.workspaceKey)
    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli", ...workspaceMeta }
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

/**
 * Render the dirty-repo preflight error using the structured workspace
 * inspection from core/git.ts. Single source of truth for "is this
 * workspace runnable?" — same probe detectGitMode uses, just formatted
 * for the CLI instead of thrown.
 */
function printDirtyRepoPreflight(rootPath: string): number {
  const inspection = inspectWorkspaceState(rootPath)
  if (inspection.kind !== "dirty") return 0

  const onBaseBranch = inspection.currentBranch === "main" || inspection.currentBranch === "master"
  const total = inspection.trackedCount + inspection.untrackedCount

  console.error("  Git preflight failed: workspace repo is dirty.")
  console.error(`  Root:   ${rootPath}`)
  console.error(`  Branch: ${inspection.currentBranch || "<unknown>"}`)
  console.error(`  Changed files: ${total} (${inspection.trackedCount} tracked, ${inspection.untrackedCount} untracked)`)
  if (onBaseBranch) {
    console.error("  Strategy violation: uncommitted work is sitting on main/master.")
    console.error("  BeerEngineer expects main/master to stay clean; item work must happen on item/* branches.")
  } else {
    console.error("  BeerEngineer requires a clean repo before starting a new item branch.")
  }
  console.error("  Next steps: git status")
  console.error("             git add -A && git commit -m \"...\"")
  console.error("             git stash push -u")
  return 73
}

function preflightCliBranchingStart(repos: Repos, workspaceId: string): number {
  const workspace = repos.getWorkspace(workspaceId)
  const rootPath = workspace?.root_path?.trim()
  if (!rootPath) return 0
  return printDirtyRepoPreflight(rootPath)
}

function hasStageArtifacts(repos: Repos, item: Pick<ItemRow, "workspace_id">, runId: string, stageId: string): boolean {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForItemRun(repos, item, run) : null
  return ctx ? existsSync(layout.stageDir(ctx, stageId)) : false
}

function latestRunWithStageArtifacts(
  repos: Repos,
  item: Pick<ItemRow, "id" | "workspace_id">,
  stageId: string,
): { id: string } | undefined {
  return repos
    .listRuns()
    .filter(run => run.item_id === item.id)
    .sort((a, b) => b.created_at - a.created_at)
    .find(run => hasStageArtifacts(repos, item, run.id, stageId))
}

function seedStageFromPreviousRun(repos: Repos, item: ItemRow, sourceRunId: string, targetRunId: string, stageId: string): boolean {
  const sourceRun = repos.getRun(sourceRunId)
  const targetRun = repos.getRun(targetRunId)
  const sourceCtx = sourceRun ? resolveWorkflowContextForItemRun(repos, item, sourceRun) : null
  const targetCtx = targetRun ? resolveWorkflowContextForItemRun(repos, item, targetRun) : null
  if (!sourceCtx || !targetCtx) return false
  const sourceStageDir = layout.stageDir(sourceCtx, stageId)
  if (!existsSync(sourceStageDir)) return false
  cpSync(sourceStageDir, layout.stageDir(targetCtx, stageId), { recursive: true })
  return true
}

/**
 * Context passed to every CLI item-action handler. Each handler gets the
 * resolved item, the action token, the repos handle, the original
 * itemRef (for error messages), and any resume flags the user passed.
 */
type CliItemActionContext = {
  item: ItemRow
  action: ItemAction
  repos: Repos
  itemRef: string
  resumeFlags?: ResumeFlags
}

type CliItemActionHandler = (ctx: CliItemActionContext) => Promise<number>

/** Shared transition + preflight prelude for handlers that start a fresh run. */
function startRunPrelude(ctx: CliItemActionContext): number {
  const transition = lookupTransitionSync(ctx.action, ctx.item.current_column, ctx.item.phase_status)
  if (transition.kind !== "start-run") {
    console.error(`  Invalid transition: ${ctx.action} from ${ctx.item.current_column}/${ctx.item.phase_status}`)
    return 1
  }
  return preflightCliBranchingStart(ctx.repos, ctx.item.workspace_id)
}

type ItemActionsModule = typeof import("./core/itemActions.js")
let lookupTransitionSync: ItemActionsModule["lookupTransition"]
let createItemActionsService: ItemActionsModule["createItemActionsService"]

const handleStartBrainstorm: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const io = createCliIO(ctx.repos)
  try {
    const runId = await runWorkflowWithSync(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      { owner: "cli", itemId: ctx.item.id },
    )
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartImplementationOrRerunDesignPrep: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start implementation: no prior brainstorm artifacts found for this item.")
    console.error("  Run start_brainstorm first, then retry start_implementation.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: ctx.action === "rerun_design_prep" ? "visual-companion" : "projects",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start implementation: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "visual-companion")
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "frontend-design")
    await prepared.start()
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartVisualCompanion: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "brainstorm")
  if (!sourceRun) {
    console.error("  Cannot start visual-companion: no prior brainstorm artifacts found.")
    console.error("  Run start_brainstorm first, then retry start_visual_companion.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: "visual-companion",
          manualStage: "visual-companion",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start visual-companion: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    await prepared.start()
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleStartFrontendDesign: CliItemActionHandler = async ctx => {
  const exit = startRunPrelude(ctx)
  if (exit !== 0) return exit
  const sourceRun = latestRunWithStageArtifacts(ctx.repos, ctx.item, "visual-companion")
  if (!sourceRun) {
    console.error("  Cannot start frontend-design: no prior visual-companion artifacts found.")
    console.error("  Run start_visual_companion first, then retry start_frontend_design.")
    return 1
  }
  const io = createCliIO(ctx.repos)
  try {
    const prepared = prepareRun(
      { id: ctx.item.id, title: ctx.item.title, description: ctx.item.description },
      ctx.repos,
      io,
      {
        owner: "cli",
        itemId: ctx.item.id,
        resume: {
          scope: { type: "run", runId: "pending" },
          currentStage: "frontend-design",
          manualStage: "frontend-design",
        },
      },
    )
    if (!seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "brainstorm")) {
      console.error("  Cannot start frontend-design: failed to seed brainstorm artifacts into the new run.")
      return 1
    }
    seedStageFromPreviousRun(ctx.repos, ctx.item, sourceRun.id, prepared.runId, "visual-companion")
    await prepared.start()
    console.log(`  ${ctx.action} applied`)
    console.log(`  run-id: ${prepared.runId}`)
    return 0
  } finally {
    io.close?.()
  }
}

const handleResumeRun: CliItemActionHandler = async ctx => {
  const active =
    ctx.repos.latestActiveRunForItem(ctx.item.id) ?? ctx.repos.latestRecoverableRunForItem(ctx.item.id)
  const resumeRunId = active?.id
  let resumePayload: { summary: string; branch?: string; commitSha?: string; reviewNotes?: string } | undefined
  if (active?.recovery_status) {
    const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY) && ctx.resumeFlags?.yes !== true
    const collected = await collectRemediationFlags(ctx.resumeFlags ?? {}, isTty)
    if (!collected || !collected.summary) {
      printResumeBlockedOutput(active.id, {
        summary: active.recovery_summary,
        scope: active.recovery_scope,
        scopeRef: active.recovery_scope_ref,
      }, ctx.itemRef)
      console.error("  Missing --remediation-summary (required for non-interactive resume).")
      return 75
    }
    resumePayload = {
      summary: collected.summary,
      branch: collected.branch,
      commitSha: collected.commit,
      reviewNotes: collected.notes,
    }
  }

  // CLI-specific resume_run: the shared service runs performResume
  // asynchronously over an API IO session; the CLI needs synchronous
  // execution so the operator sees the outcome before returning.
  if (resumePayload && resumeRunId) {
    const { loadResumeReadiness, performResume } = await import("./core/resume.js")
    const readiness = await loadResumeReadiness(ctx.repos, resumeRunId)
    if (readiness.kind === "not_found") {
      console.error(`  Item not found: ${ctx.itemRef}`)
      return 1
    }
    if (readiness.kind === "not_resumable") {
      console.error(`  Not resumable: ${readiness.reason}`)
      return 2
    }
    if (readiness.kind === "no_recovery") {
      console.error(`  Invalid transition: ${ctx.action} from ${ctx.item.current_column}/${ctx.item.phase_status}`)
      return 1
    }

    const scopeRef =
      readiness.record.scope.type === "stage"
        ? readiness.record.scope.stageId
        : readiness.record.scope.type === "story"
        ? `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
        : null
    const remediation = ctx.repos.createExternalRemediation({
      runId: resumeRunId,
      scope: readiness.record.scope.type,
      scopeRef,
      summary: resumePayload.summary,
      branch: resumePayload.branch,
      commitSha: resumePayload.commitSha,
      reviewNotes: resumePayload.reviewNotes,
      source: "cli",
    })

    const io = createCliIO(ctx.repos)
    try {
      console.log(`  ${ctx.action} applied`)
      console.log(`  run-id: ${resumeRunId}`)
      console.log(`  remediation-id: ${remediation.id}`)
      await performResume({ repos: ctx.repos, io, runId: resumeRunId, remediation })
      const refreshed = ctx.repos.getRun(resumeRunId)
      if (refreshed?.recovery_status === "blocked") {
        printResumeBlockedOutput(resumeRunId, {
          summary: refreshed.recovery_summary,
          scope: refreshed.recovery_scope,
          scopeRef: refreshed.recovery_scope_ref,
        }, ctx.itemRef)
      }
      return 0
    } finally {
      io.close?.()
    }
  }

  return runDefaultItemAction(ctx, resumePayload)
}

/**
 * Fallback handler: any action without a CLI-specific override goes through
 * the shared {@link createItemActionsService}, which wires the standard
 * (API-style) IO and lifecycle.
 */
async function runDefaultItemAction(
  ctx: CliItemActionContext,
  resumePayload?: { summary: string; branch?: string; commitSha?: string; reviewNotes?: string },
): Promise<number> {
  const service = createItemActionsService(ctx.repos)
  try {
    const result = await service.perform(
      ctx.item.id,
      ctx.action,
      resumePayload ? { resume: resumePayload } : undefined,
    )
    if (!result.ok) {
      if (result.status === 404) console.error(`  Item not found: ${ctx.itemRef}`)
      else if (result.status === 422) {
        console.error(`  Missing remediation summary (pass --remediation-summary).`)
        return 75
      } else if (result.error === "not_resumable" || result.error === "resume_in_progress") {
        console.error(`  Not resumable: ${result.error}`)
        return 2
      } else {
        console.error(`  Invalid transition: ${result.action} from ${result.current.column}/${result.current.phaseStatus}`)
      }
      return 1
    }
    console.log(`  ${ctx.action} applied`)
    if (result.kind === "needs_spawn" && result.runId) console.log(`  run-id: ${result.runId}`)
    if (result.kind === "needs_spawn" && result.remediationId) console.log(`  remediation-id: ${result.remediationId}`)
    if (result.kind === "needs_spawn" && result.runId) {
      const refreshed = ctx.repos.getRun(result.runId)
      if (refreshed?.recovery_status === "blocked") {
        printResumeBlockedOutput(result.runId, {
          summary: refreshed.recovery_summary,
          scope: refreshed.recovery_scope,
          scopeRef: refreshed.recovery_scope_ref,
        }, ctx.itemRef)
      }
    }
    return 0
  } finally {
    service.dispose()
  }
}

/**
 * CLI-specific item-action registry. Each entry overrides the default
 * (shared service) handler with one that runs synchronously in the
 * terminal — owner=cli, stdio IO, blocks until the run ends.
 *
 * Adding a CLI-specific override is a one-line registry edit; actions
 * not in this map fall through to {@link runDefaultItemAction}.
 */
const CLI_ITEM_ACTION_HANDLERS: Partial<Record<ItemAction, CliItemActionHandler>> = {
  start_brainstorm: handleStartBrainstorm,
  start_visual_companion: handleStartVisualCompanion,
  start_frontend_design: handleStartFrontendDesign,
  start_implementation: handleStartImplementationOrRerunDesignPrep,
  rerun_design_prep: handleStartImplementationOrRerunDesignPrep,
  resume_run: handleResumeRun,
}

export async function runItemAction(itemRef: string, action: string, resumeFlags?: ResumeFlags): Promise<number> {
  const itemActions = await import("./core/itemActions.js")
  if (!itemActions.isItemAction(action)) {
    console.error(`  Unknown action: ${action}`)
    return 1
  }
  // Late-bind the helpers shared by handlers so the registry can declare
  // them at module load without requiring async imports at every call.
  lookupTransitionSync = itemActions.lookupTransition
  createItemActionsService = itemActions.createItemActionsService
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
    const ctx: CliItemActionContext = {
      item: resolved.item,
      action,
      repos,
      itemRef,
      resumeFlags,
    }
    const handler = CLI_ITEM_ACTION_HANDLERS[action] ?? runDefaultItemAction
    return await handler(ctx)
  } finally {
    db.close()
  }
}

async function runUpdateCommand(cmd: Extract<Command, { kind: "update" }>): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is unavailable. Run beerengineer setup first.")
    return 2
  }
  const db = initDatabase()
  try {
    const repos = new Repos(db)
    const status = buildUpdateStatus(repos, config)
    if (cmd.rollback) {
      const payload = {
        status,
        error: "post-migration-rollback-unsupported",
        code: "post-migration-rollback-unsupported",
      }
      if (cmd.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      } else {
        console.error("  Manual rollback is not supported after migrations have run.")
        console.error("  Restore the pre-update backup manually instead.")
        console.error("  code:             post-migration-rollback-unsupported")
      }
      return 1
    }
    if (cmd.dryRun) {
      try {
        const dryRun = await runUpdateDryRun(repos, config, {
          version: cmd.version,
          allowLegacyDbShadow: cmd.allowLegacyDbShadow,
        })
        const nextStatus = buildUpdateStatus(repos, config, { latestRelease: dryRun.targetRelease })
        if (cmd.json) {
          process.stdout.write(`${JSON.stringify({ status: nextStatus, dryRun }, null, 2)}\n`)
          return dryRun.status === "aborted-dry-run" ? 0 : 1
        }
        console.log(`  dry-run status:   ${dryRun.status}`)
        console.log(`  current version:  ${dryRun.currentVersion}`)
        console.log(`  target release:   ${dryRun.targetRelease.tag}`)
        console.log(`  update repo:      ${dryRun.githubRepo}`)
        console.log(`  install root:     ${nextStatus.install.root}`)
        if (dryRun.warnings.length > 0) {
          console.log(`  warnings:         ${dryRun.warnings.join(", ")}`)
        }
        dryRun.stages.forEach(stage => {
          console.log(`  ${stage.name.padEnd(16)} ${stage.status.toUpperCase()}  ${stage.detail}`)
        })
        return dryRun.status === "aborted-dry-run" ? 0 : 1
      } catch (err) {
        if (cmd.json) {
          process.stdout.write(`${JSON.stringify({ status, error: (err as Error).message }, null, 2)}\n`)
        } else {
          console.error(`  Update dry-run failed: ${(err as Error).message}`)
        }
        return 1
      }
    }
    if (!cmd.check) {
      try {
        const remote = await maybeSubmitRemoteUpdateApply(config, cmd)
        const apply = remote?.apply ?? await prepareUpdateApply(repos, config, {
          version: cmd.version,
          allowLegacyDbShadow: cmd.allowLegacyDbShadow,
        })
        const execution = remote?.execution ?? await maybeStartPreparedUpdateExecution(repos, config, apply.operationId, apply.switcherPath)
        if (cmd.json) {
          process.stdout.write(`${JSON.stringify({ status: buildUpdateStatus(repos, config, { latestRelease: apply.targetRelease }), apply, execution }, null, 2)}\n`)
          return 0
        }
        console.log(`  apply state:      ${apply.state}`)
        console.log(`  operation id:     ${apply.operationId}`)
        console.log(`  current version:  ${apply.currentVersion}`)
        console.log(`  target release:   ${apply.targetRelease.tag}`)
        console.log(`  update repo:      ${apply.githubRepo}`)
        console.log(`  staged root:      ${apply.stagedRoot}`)
        console.log(`  switcher script:  ${apply.switcherPath}`)
        if (apply.warnings.length > 0) {
          console.log(`  warnings:         ${apply.warnings.join(", ")}`)
        }
        if (execution.started) {
          console.log("  shutdown:         accepted")
          console.log("  executor:         started")
        } else {
          console.log(`  executor:         not started (${execution.reason})`)
          console.log("  The release has been staged and recorded, but no live local engine was available for automatic shutdown.")
        }
        return 0
      } catch (err) {
        if (cmd.json) {
          process.stdout.write(`${JSON.stringify({ status, error: (err as Error).message }, null, 2)}\n`)
        } else {
          console.error(`  Update apply preparation failed: ${(err as Error).message}`)
        }
        return 1
      }
    }
    const operationId = randomUUID()
    try {
      const check = await runUpdateCheck(config, { version: cmd.version })
      repos.upsertUpdateAttempt({
        operationId,
        kind: "check",
        status: "succeeded",
        fromVersion: check.currentVersion,
        targetVersion: check.latestRelease.version,
        dbPath: status.dbPath,
        dbPathSource: status.dbPathSource,
        legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
        installRoot: status.install.root,
        metadataJson: JSON.stringify({ checkedAt: check.checkedAt, githubRepo: check.githubRepo }),
        completedAt: Date.now(),
      })
      if (cmd.json) {
        process.stdout.write(`${JSON.stringify({ status: buildUpdateStatus(repos, config, { latestRelease: check.latestRelease }), check }, null, 2)}\n`)
        return 0
      }
      console.log(`  current version: ${check.currentVersion}`)
      console.log(`  latest release:  ${check.latestRelease.tag}`)
      console.log(`  update repo:     ${check.githubRepo}`)
      console.log(`  published:       ${check.latestRelease.publishedAt ?? "unknown"}`)
      console.log(`  available:       ${check.updateAvailable ? "yes" : "no"}`)
      if (status.warnings.length > 0) {
        console.log(`  warnings:        ${status.warnings.join(", ")}`)
      }
      console.log(`  db path:         ${status.dbPath} (${status.dbPathSource})`)
      console.log(`  install root:    ${status.install.root}`)
      console.log(`  release url:     ${check.latestRelease.url}`)
      return 0
    } catch (err) {
      repos.upsertUpdateAttempt({
        operationId,
        kind: "check",
        status: "failed",
        fromVersion: status.currentVersion,
        dbPath: status.dbPath,
        dbPathSource: status.dbPathSource,
        legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
        installRoot: status.install.root,
        errorMessage: (err as Error).message,
        completedAt: Date.now(),
      })
      if (cmd.json) {
        process.stdout.write(`${JSON.stringify({ status, error: (err as Error).message }, null, 2)}\n`)
      } else {
        console.error(`  Update check failed: ${(err as Error).message}`)
      }
      return 1
    }
  } finally {
    db.close()
  }
}

async function maybeStartPreparedUpdateExecution(
  repos: Repos,
  config: AppConfig,
  operationId: string,
  switcherPath: string,
): Promise<{ started: boolean; reason: string }> {
  const pid = readEnginePidFile()
  if (pid && pid.port === config.enginePort) {
    return { started: false, reason: "engine_running_use_api_apply" }
  }
  if (!existsSync(join(config.dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js"))) {
    return { started: false, reason: "managed_current_missing" }
  }
  if (!markPreparedUpdateInFlight(repos, operationId)) {
    return { started: false, reason: "update_attempt_not_queued" }
  }
  const child = spawn(switcherPath, [], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  })
  child.unref()
  return { started: true, reason: "local_executor_started" }
}

async function maybeSubmitRemoteUpdateApply(
  config: AppConfig,
  cmd: Extract<Command, { kind: "update" }>,
): Promise<null | {
  apply: {
    operationId: string
    state: string
    currentVersion: string
    targetRelease: { tag: string; version: string; publishedAt: string | null; tarballUrl: string; url: string }
    githubRepo: string
    stagedRoot: string
    switcherPath: string
    metadataPath: string
    warnings: string[]
  }
  execution: { started: boolean; reason: string }
}> {
  const pid = readEnginePidFile()
  if (!pid || pid.port !== config.enginePort) return null
  if (!existsSync(join(config.dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js"))) {
    return null
  }
  const token = process.env.BEERENGINEER_API_TOKEN ?? readApiTokenFile()
  if (!token) return null
  const response = await fetch(`http://127.0.0.1:${config.enginePort}/update/apply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-beerengineer-token": token,
    },
    body: JSON.stringify({
      version: cmd.version,
      allowLegacyDbShadow: cmd.allowLegacyDbShadow === true,
    }),
  }).catch(() => null)
  if (!response) return null
  if (response.status !== 202) {
    const body = await response.json().catch(() => ({ error: `http_${response.status}` })) as { error?: string }
    throw new Error(body.error || `update_apply_failed:http_${response.status}`)
  }
  const apply = await response.json() as {
    operationId: string
    state: string
    currentVersion: string
    targetRelease: { tag: string; version: string; publishedAt: string | null; tarballUrl: string; url: string }
    githubRepo: string
    stagedRoot: string
    switcherPath: string
    metadataPath: string
    warnings: string[]
  }
  return {
    apply,
    execution: { started: true, reason: "engine_handoff_requested" },
  }
}

/**
 * Validate a setup-group name (shared by `doctor` and `setup`). Returns
 * the exit code to use, or `null` to proceed.
 */
function validateGroup(group: string | undefined): number | null {
  if (group && !isKnownGroupId(group)) {
    console.error(`  Unknown setup group: ${group}`)
    return 2
  }
  return null
}

/**
 * Per-command handler type — each maps a typed `Command` variant to its
 * exit code. Variants without an entry must be handled inline in
 * {@link main} (the special cases: `help`, `unknown`, `workflow`, which
 * have non-trivial control flow that doesn't fit a return-an-exit-code
 * shape).
 */
type CommandHandlers = {
  [K in Command["kind"]]?: (cmd: Extract<Command, { kind: K }>) => Promise<number>
}

/**
 * Single source of truth for CLI command dispatch. Each entry returns an
 * exit code; {@link main} `process.exit()`s with the result.
 *
 * Adding a new command: add a `Command` variant in the discriminated
 * union, parse it in `parseArgs`, and add an entry here. No switch edit
 * needed.
 */
const COMMAND_REGISTRY: CommandHandlers = {
  "start-engine": async () => startEngine(),
  doctor: async cmd => {
    const exit = validateGroup(cmd.group)
    if (exit !== null) return exit
    return runDoctor({ json: cmd.json, group: cmd.group })
  },
  setup: async cmd => {
    const exit = validateGroup(cmd.group)
    if (exit !== null) return exit
    return runSetupCommand({ group: cmd.group, noInteractive: cmd.noInteractive })
  },
  update: cmd => runUpdateCommand(cmd),
  "notifications-test": cmd => runNotificationsTestCommand(cmd.channel),
  "workspace-preview": cmd => runWorkspacePreviewCommand(cmd.path, cmd.json),
  "workspace-add": cmd => runWorkspaceAddCommand(cmd),
  "workspace-list": cmd => runWorkspaceListCommand(cmd.json),
  "workspace-get": cmd => runWorkspaceGetCommand(cmd.key, cmd.json),
  "workspace-items": cmd => runWorkspaceItemsCommand(cmd.key, cmd.json),
  "workspace-use": cmd => runWorkspaceUseCommand(cmd.key),
  "workspace-remove": cmd =>
    runWorkspaceRemoveCommand(cmd.key, cmd.purge, cmd.json, cmd.yes, cmd.noInteractive),
  "workspace-open": cmd => runWorkspaceOpenCommand(cmd.key),
  "workspace-backfill": cmd => runWorkspaceBackfillCommand(cmd.json),
  "workspace-worktree-gc": cmd => runWorkspaceWorktreeGcCommand(cmd.key, cmd.json),
  status: cmd => runStatusCommand(cmd.workspaceKey, cmd.all, cmd.json),
  "chat-list": cmd => runChatListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  chats: cmd => runChatListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "chat-send": cmd => runChatSendCommand(cmd),
  "chat-answer": cmd => runChatAnswerCommand(cmd),
  items: cmd => runItemsCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "item-get": cmd => runItemGetCommand(cmd.itemRef, cmd.workspaceKey, cmd.json),
  "item-open": cmd => runItemOpenCommand(cmd.itemRef, cmd.workspaceKey),
  "item-preview": cmd => runItemPreviewCommand(cmd.itemRef, cmd.workspaceKey, { start: cmd.start, open: cmd.open, json: cmd.json }),
  "item-wireframes": cmd =>
    runItemWireframesCommand(cmd.itemRef, cmd.workspaceKey, cmd.open, cmd.json),
  "item-design": cmd => runItemDesignCommand(cmd.itemRef, cmd.workspaceKey, cmd.open, cmd.json),
  "run-list": cmd => runRunListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  runs: cmd => runRunListCommand(cmd.workspaceKey, cmd.all, cmd.json, cmd.compact),
  "run-get": cmd => runRunGetCommand(cmd.runId, cmd.json),
  "run-open": cmd => runRunOpenCommand(cmd.runId),
  "run-tail": cmd => runRunTailCommand(cmd),
  "run-messages": cmd => runRunMessagesCommand(cmd),
  "run-watch": cmd => runRunWatchCommand(cmd),
  "start-ui": () => startUi(),
  "item-action": cmd => runItemAction(cmd.itemRef, cmd.action, cmd.resume),
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cmd = parseArgs(argv)

  // Special cases: variants whose exit semantics don't fit "return an exit
  // code" — `help` returns void after printing, `unknown` exits 1, and
  // `workflow` has its own try/catch with mode-specific error rendering.
  if (cmd.kind === "help") {
    printHelp()
    return
  }
  if (cmd.kind === "unknown") {
    console.error(`  Unknown command: ${cmd.token}`)
    printHelp()
    process.exit(1)
  }
  if (cmd.kind === "workflow") {
    try {
      await runInteractiveWorkflow({ json: cmd.json, workspaceKey: cmd.workspaceKey })
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

  const handler = COMMAND_REGISTRY[cmd.kind]
  if (!handler) {
    console.error(`  No handler registered for command kind: ${cmd.kind}`)
    process.exit(1)
  }
  // Cast required: TS can't narrow `cmd` against the registry's mapped-type
  // value through indexed access. The discriminated union still guarantees
  // the runtime type matches the handler's parameter type.
  process.exit(await (handler as (c: Command) => Promise<number>)(cmd))
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isEntrypoint) {
  main()
}

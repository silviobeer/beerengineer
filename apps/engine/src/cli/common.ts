import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { ask, close } from "../sim/human.js"
import { initDatabase } from "../db/connection.js"
import { Repos, type ItemRow } from "../db/repositories.js"
import { inspectWorkspaceState } from "../core/git.js"
import { layout } from "../core/workspaceLayout.js"
import { latestCompletedRunForItem } from "../core/itemWorkspace.js"
import { resolveItemPreviewContext } from "../core/itemPreview.js"
import { isPortListening, resolvePreviewLaunchSpec, startPreviewServer, stopPreviewServer } from "../core/previewLauncher.js"
import { resolveWorkflowContextForRun } from "../core/workflowContextResolver.js"
import { projectStageLogRow, type MessageEntry } from "../core/messagingProjection.js"
import { shouldDeliverAtLevel, type MessagingLevel } from "../core/messagingLevel.js"
import { renderMessageEntry, terminalExitCodeForEntry } from "../core/messageRendering.js"
import { tailStageLogs } from "../api/sse/tailStageLogs.js"
import {
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
  validateHarnessProfileShape,
} from "../setup/config.js"
import { generateSetupReport, runDoctorCommand } from "../setup/doctor.js"
import type { AppConfig } from "../setup/types.js"
import type { HarnessProfile } from "../types/workspace.js"
import { resolveUiLaunchUrl } from "./ui.js"

export const EXIT_USAGE = 20
export const EXIT_TRANSPORT = 30

export function withRepos<T>(run: (repos: Repos) => Promise<T>): Promise<T> {
  const db = initDatabase()
  const repos = new Repos(db)
  return run(repos).finally(() => db.close())
}

export function resolveCliStatePath(): string {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  return join(dirname(configPath), "cli-state.json")
}

export function loadCliState(): { currentWorkspaceKey?: string } {
  try {
    return JSON.parse(readFileSync(resolveCliStatePath(), "utf8")) as { currentWorkspaceKey?: string }
  } catch {
    return {}
  }
}

export function saveCliState(patch: { currentWorkspaceKey?: string }): void {
  const statePath = resolveCliStatePath()
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify({ ...loadCliState(), ...patch }, null, 2), "utf8")
}

function isGenericPrompt(prompt: string | null | undefined): boolean {
  return !prompt || /^\s*you\s*>\s*$/i.test(prompt)
}

export function shortRunId(runId: string): string {
  return runId.slice(0, 8)
}

function latestByCreatedAt<T extends { created_at: number }>(rows: T[]): T | undefined {
  return [...rows].sort((a: T, b: T) => b.created_at - a.created_at)[0]
}

export function latestRunForItem(repos: Repos, itemId: string) {
  return latestByCreatedAt(repos.listRuns().filter(run => run.item_id === itemId))
}

function latestLogMessageForRun(repos: Repos, runId: string, eventType: "chat_message" | "prompt_answered"): string | null {
  return repos
    .listLogsForRun(runId)
    .filter(log => log.event_type === eventType && log.message.trim().length > 0)
    .sort((a, b) => b.created_at - a.created_at)[0]?.message ?? null
}

function latestQuestionForRun(repos: Repos, runId: string): string | null {
  return latestLogMessageForRun(repos, runId, "chat_message")
}

function latestAnswerForRun(repos: Repos, runId: string): string | null {
  return latestLogMessageForRun(repos, runId, "prompt_answered")
}

export function promptDisplayText(repos: Repos, prompt: { run_id: string; prompt: string }): string {
  return isGenericPrompt(prompt.prompt) ? latestQuestionForRun(repos, prompt.run_id) ?? prompt.prompt : prompt.prompt
}

export function deriveRunStatus(run: { status: string; recovery_status: string | null }, hasPrompt: boolean): string {
  if (hasPrompt) return "needs_answer"
  if (run.recovery_status === "blocked") return "blocked"
  if (run.recovery_status === "failed" || run.status === "failed") return "failed"
  if (run.status === "completed") return "completed"
  return run.status
}

export function deriveItemStatus(
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

const ITEM_SORT_WEIGHTS: Record<string, number> = {
  needs_answer: 0,
  blocked: 1,
  running: 2,
  review_required: 3,
  failed: 4,
  done: 9,
}

export function itemSortWeight(status: string): number {
  return ITEM_SORT_WEIGHTS[status] ?? 5
}

const RUN_SORT_WEIGHTS: Record<string, number> = {
  needs_answer: 0,
  blocked: 1,
  running: 2,
  failed: 3,
  completed: 9,
}

export function runSortWeight(status: string): number {
  return RUN_SORT_WEIGHTS[status] ?? 5
}

export function truncate(text: string, max: number): string {
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

export function listProjectedMessages(
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
    nextSince: entries.length === input.limit ? entries.at(-1)?.id ?? null : null,
  }
}

export function printMessageEntry(entry: MessageEntry): void {
  console.log(`  ${renderMessageEntry(entry)}`)
}

export function emitJsonLine(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

export function readAnswerBody(opts: { provided?: string; multiline?: boolean }): string {
  if (opts.provided !== undefined) return opts.provided
  const raw = readFileSync(0, "utf8")
  if (opts.multiline) return raw.trimEnd()
  return raw.split(/\r?\n/)[0]?.trim() ?? ""
}

export async function isUiReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/", url), { method: "HEAD", signal: AbortSignal.timeout(1500) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

export function openBrowser(url: string): void {
  if (process.env.BEERENGINEER_DISABLE_BROWSER_OPEN === "1") return
  let command: { cmd: string; args: string[] }
  if (process.platform === "darwin") {
    command = { cmd: "open", args: [url] }
  } else if (process.platform === "win32") {
    command = { cmd: "cmd", args: ["/c", "start", "", url] }
  } else {
    command = { cmd: "xdg-open", args: [url] }
  }

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

export function resolveSelectedWorkspace(repos: Repos, explicit?: string) {
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

function resolveStageArtifactPath(repos: Repos, runId: string, stageId: string, fileName: string): string | null {
  const run = repos.getRun(runId)
  const ctx = run ? resolveWorkflowContextForRun(repos, run) : null
  return ctx ? join(layout.stageArtifactsDir(ctx, stageId), fileName) : null
}

export function readArtifactJson<T>(repos: Repos, runId: string, stageId: string, fileName: string): T | null {
  const path = resolveStageArtifactPath(repos, runId, stageId, fileName)
  if (!path) return null
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8")) as T
}

export function artifactPath(repos: Repos, runId: string, stageId: string, fileName: string): string | null {
  return resolveStageArtifactPath(repos, runId, stageId, fileName)
}

export async function runDoctor(options: { json?: boolean; group?: string } = {}): Promise<number> {
  if (options.json) {
    const report = await generateSetupReport({ group: options.group })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.overall === "blocked" ? 1 : 0
  }
  return runDoctorCommand({ group: options.group })
}

export function loadEffectiveConfig(): AppConfig | null {
  const overrides = resolveOverrides()
  const configPath = resolveConfigPath(overrides)
  const state = readConfigFile(configPath)
  return resolveMergedConfig(state, overrides)
}

export function parseHarnessProfile(input: { profile?: string; profileJson?: string }, config: AppConfig): HarnessProfile {
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

export function gitState(rootPath: string | null): string {
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

export function printItemCommandError(json: boolean, code: number, reason: string, message: string): number {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, code, reason })}\n`)
  else console.error(message)
  return code
}

export function resolvePublicBaseUrl(): string {
  return loadEffectiveConfig()?.publicBaseUrl?.trim() || resolveUiLaunchUrl()
}

export function resolveCliItem(
  repos: Repos,
  itemRef: string,
  workspaceKey?: string,
): { item: ItemRow; workspaceKey?: string } | null {
  if (workspaceKey) {
    const workspace = repos.getWorkspaceByKey(workspaceKey)
    if (!workspace) return null
    const item = repos.getItemByCode(workspace.id, itemRef) ?? repos.getItem(itemRef)
    if (item?.workspace_id !== workspace.id) return null
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

export type PreviewState = {
  logPath?: string
  pid: number | null | undefined
  status: "started" | "already_running" | "stopped" | "already_stopped"
}

export async function resolvePreviewState(
  preview: {
    worktreePath: string
    previewHost: string
    previewPort: number
  } & Record<string, unknown>,
  opts: { start?: boolean; stop?: boolean },
): Promise<PreviewState | null> {
  if (opts.start) {
    return runPreviewTransition(() => startPreviewServer(preview))
  }
  if (opts.stop) {
    return runPreviewTransition(() => stopPreviewServer(preview))
  }
  return {
    status: (await isPortListening(preview.previewHost, preview.previewPort)) ? "already_running" : "stopped",
    pid: undefined,
  }
}

async function runPreviewTransition(
  action: () => Promise<{ status: PreviewState["status"]; logPath?: string; pid: number | null }>,
): Promise<PreviewState | null> {
  try {
    return await action()
  } catch (error) {
    console.error(`  ${(error as Error).message}`)
    return null
  }
}

export function buildPreviewPayload(
  resolved: { item: ItemRow; workspaceKey?: string },
  preview: {
    branch: string
    worktreePath: string
    previewHost: string
    previewPort: number
    previewUrl: string
  },
  launch: ReturnType<typeof resolvePreviewLaunchSpec>,
  previewState: PreviewState,
) {
  return {
    itemId: resolved.item.id,
    workspaceKey: resolved.workspaceKey,
    branch: preview.branch,
    worktreePath: preview.worktreePath,
    previewHost: preview.previewHost,
    previewPort: preview.previewPort,
    previewUrl: preview.previewUrl,
    status: previewState.status,
    pid: previewState.pid,
    launch: launch
      ? {
          command: launch.command,
          cwd: launch.cwd,
          source: launch.source,
        }
      : null,
    logPath: previewState.logPath ?? join(preview.worktreePath, ".beerengineer-preview.log"),
  }
}

export async function runRunTail(repos: Repos, input: { runId: string; level: MessagingLevel; since?: string; json?: boolean }): Promise<number> {
  const run = repos.getRun(input.runId)
  if (!run) {
    console.error(`  Run not found: ${input.runId}`)
    return 1
  }
  const sinceId =
    input.since ??
    repos.listLogsForRunAfterCursor(input.runId, 0).at(-1)?.id ??
    undefined

  return await new Promise<number>((resolve) => {
    let resolved = false
    const finish = (code: number): void => {
      if (resolved) return
      resolved = true
      tail.stop()
      resolve(code)
    }
    const tail = tailStageLogs(repos, { scope: { kind: "run", runId: input.runId }, sinceId }, row => {
      const entry = projectStageLogRow(row)
      if (!entry || !shouldDeliverAtLevel(entry, input.level)) return
      if (input.json) emitJsonLine(entry)
      else printMessageEntry(entry)
      const exitCode = terminalExitCodeForEntry(entry)
      if (exitCode !== null) finish(exitCode)
    })
    tail.pollOnce()

    const terminal = currentRunTerminalCode(repos, input.runId)
    if (terminal !== null && !resolved) finish(terminal)
  })
}

export function printPreview(preview: Awaited<ReturnType<typeof import("../core/workspaces.js").previewWorkspace>>): void {
  console.log("")
  console.log("  Preview")
  console.log(`    path:             ${preview.path}`)
  console.log(`    exists:           ${preview.exists}`)
  console.log(`    greenfield:       ${preview.isGreenfield}`)
  console.log(`    writable:         ${preview.isWritable}`)
  console.log(`    allowed root:     ${preview.isInsideAllowedRoot}`)
  const defaultBranchSuffix = preview.defaultBranch ? ` (${preview.defaultBranch})` : ""
  console.log(`    git repo:         ${preview.isGitRepo}${defaultBranchSuffix}`)
  console.log(`    registered:       ${preview.isRegistered}`)
  if (preview.detectedStack) console.log(`    detected stack:   ${preview.detectedStack}`)
  if (preview.existingFiles.length > 0) console.log(`    top-level files:  ${preview.existingFiles.join(", ")}`)
  for (const conflict of preview.conflicts) console.log(`    conflict:         ${conflict}`)
  console.log("")
}

export function indentBlock(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces)
  return text
    .split("\n")
    .map(line => `${prefix}${line}`)
    .join("\n")
}

export async function confirmWorkspacePurge(input: {
  repos: Repos
  key: string
  purge: boolean
  yes: boolean
  noInteractive: boolean
  json: boolean
}): Promise<number | null> {
  if (!input.purge || input.yes) return null
  const workspace = input.repos.getWorkspaceByKey(input.key)
  const targetPath = workspace?.root_path ?? "(unknown path)"
  const interactive = !input.noInteractive && !input.json && process.stdin.isTTY && process.stdout.isTTY
  if (!interactive) {
    const message = `Refusing to purge workspace ${input.key} (${targetPath}) without --yes in non-interactive mode.`
    if (input.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: "confirmation_required", detail: message }, null, 2)}\n`)
    } else {
      console.error(`  ${message}`)
      console.error(`  Re-run with: beerengineer workspace remove ${input.key} --purge --yes`)
    }
    return 2
  }
  const answer = await ask(`  About to rm -rf ${targetPath}. This cannot be undone. Type 'yes' to confirm: `)
  close()
  if (answer.trim().toLowerCase() === "yes") return null
  console.log("  Purge cancelled.")
  return 1
}

export function latestCompletedItemRun(repos: Repos, itemId: string) {
  return latestCompletedRunForItem(repos, itemId)
}

export function resolveItemPreview(repos: Repos, itemId: string) {
  return resolveItemPreviewContext(repos, itemId)
}

export function resolvePreviewLaunch(worktreePath: string) {
  return resolvePreviewLaunchSpec(worktreePath)
}

export function latestRunAnswerForRun(repos: Repos, runId: string): string | null {
  return latestAnswerForRun(repos, runId)
}

export { KNOWN_GROUP_IDS } from "../setup/config.js"
export type { DesignArtifact, WireframeArtifact } from "../types.js"

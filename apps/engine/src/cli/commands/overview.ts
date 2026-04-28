import { projectStageLogRow } from "../../core/messagingProjection.js"
import { terminalExitCodeForEntry } from "../../core/messageRendering.js"
import {
  artifactPath,
  deriveItemStatus,
  deriveRunStatus,
  latestRunForItem,
  openBrowser,
  printItemCommandError,
  promptDisplayText,
  readArtifactJson,
  resolveCliItem,
  resolveItemPreview,
  resolvePreviewLaunch,
  resolvePreviewState,
  resolvePublicBaseUrl,
  resolveSelectedWorkspace,
  runRunTail,
  shortRunId,
  truncate,
  withRepos,
  type DesignArtifact,
  type WireframeArtifact,
  buildPreviewPayload,
  emitJsonLine,
  listProjectedMessages,
  printMessageEntry,
  readAnswerBody,
  EXIT_USAGE,
} from "../common.js"
import type { Command } from "../types.js"
import {
  describeWorkspaceGit,
  findItemByRef,
  jsonOut,
  listChatRows,
  listItemRows,
  listRunRows,
  listWorkspaceStatusRows,
  maybeOpenFile,
  missingItemRef,
  missingRunId,
  notFoundItem,
  notFoundRun,
  openOrPrintUrl,
  printChatRows,
  printItemRows,
  printRunRows,
  resolveItemCompletedRun,
  workspaceState,
} from "./overviewShared.js"

export async function runItemsCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  return withRepos(async repos => {
    const selectedWorkspace = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
    let workspaces = repos.listWorkspaces()
    if (!all) workspaces = selectedWorkspace ? [selectedWorkspace] : []
    if (workspaces.length === 0) {
      console.error("  No workspace selected.")
      return 1
    }
    const rows = listItemRows(repos, workspaceKey, all)
    if (json) return jsonOut(rows)
    console.log(all ? "  Items across all workspaces" : `  Items for workspace ${workspaces[0]?.key ?? "(unknown)"}`)
    printItemRows(rows, compact)
    return 0
  })
}

export async function runWorkspaceItemsCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace items <key>")
    return 2
  }
  return runItemsCommand(key, false, json, false)
}

export async function runChatListCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  return withRepos(async repos => {
    const workspace = all ? undefined : resolveSelectedWorkspace(repos, workspaceKey)
    const rows = listChatRows(repos, workspaceKey, all)
    if (json) return jsonOut(rows)
    console.log(all ? "  Open chats across all workspaces" : `  Open chats for workspace ${workspace?.key ?? "—"}`)
    printChatRows(rows, compact)
    return 0
  })
}

export async function runStatusCommand(workspaceKey: string | undefined, all = false, json = false): Promise<number> {
  return withRepos(async repos => {
    if (all) {
      const workspaces = repos.listWorkspaces()
      const promptRows = repos.listOpenPrompts()
      const rows = listWorkspaceStatusRows(repos)
      if (json) return jsonOut(rows)
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
    const latestRun = [...runs].sort((a, b) => b.created_at - a.created_at)[0]
    const state = workspaceState(runs, openPrompts.length > 0)
    if (json) return jsonOut({ workspace: workspace.key, state, itemCount: items.length, runCount: runs.length, chatCount: openPrompts.length })
    console.log(`  Workspace ${workspace.key}`)
    console.log(`  state: ${state}`)
    console.log(`  root: ${workspace.root_path ?? "—"}`)
    console.log(`  git: ${describeWorkspaceGit(workspace.root_path)}`)
    console.log(`  counts: items=${items.length} runs=${runs.length} chats=${openPrompts.length}`)
    if (latestRun) console.log(`  latest run: run/${shortRunId(latestRun.id)} / ${latestRun.current_stage ?? "—"} / ${deriveRunStatus(latestRun, openPrompts.some(prompt => prompt.run_id === latestRun.id))}`)
    return 0
  })
}

export async function runItemGetCommand(itemRef: string | undefined, workspaceKey: string | undefined, json = false): Promise<number> {
  if (!itemRef) return missingItemRef("item get")
  return withRepos(async repos => {
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 1
    const item = findItemByRef(repos, workspace.id, itemRef)
    if (!item) return notFoundItem(itemRef)
    const latestRun = latestRunForItem(repos, item.id)
    const prompt = latestRun ? repos.getOpenPrompt(latestRun.id) : undefined
    const status = deriveItemStatus(item, latestRun, Boolean(prompt))
    const openChat = prompt ? promptDisplayText(repos, prompt) : null
    if (json) return jsonOut({ item, workspace: workspace.key, latestRun, status, openChat })
    console.log(`  ${item.code}  ${item.title}`)
    console.log(`  workspace: ${workspace.key}`)
    console.log(`  stage/status: ${latestRun?.current_stage ?? item.current_column} / ${status}`)
    if (latestRun) console.log(`  run: ${latestRun.id} (${latestRun.status})`)
    if (openChat) console.log(`  open chat: ${openChat}`)
    return 0
  })
}

export async function runItemWireframesCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  open = false,
  json = false,
): Promise<number> {
  if (!itemRef) return missingItemRef("item wireframes")
  return withRepos(async repos => {
    const ctx = resolveItemCompletedRun(repos, itemRef, workspaceKey, json)
    if (!ctx.ok) return ctx.code
    const { item, run } = ctx
    const artifact = readArtifactJson<WireframeArtifact>(repos, run.id, "visual-companion", "wireframes.json")
    if (!artifact) {
      return printItemCommandError(json, 3, `no design-prep artifacts for ${item.code} (hasUi=false)`, `  no design-prep artifacts for ${item.code} (hasUi=false)`)
    }
    const screenMapPath = artifactPath(repos, run.id, "visual-companion", "screen-map.html")
    if (json) {
      jsonOut({
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
      }, false)
      maybeOpenFile(screenMapPath, open)
      return 0
    }
    console.log("  screen  projects  purpose  file")
    artifact.screens.forEach(screen => {
      const mockupPath = artifactPath(repos, run.id, "visual-companion", `${screen.id}.html`)
      console.log(`  ${screen.id}  ${screen.projectIds.join(",")}  ${truncate(screen.purpose, 30)}  ${mockupPath}`)
    })
    console.log(`  screen-map: ${screenMapPath}`)
    maybeOpenFile(screenMapPath, open)
    return 0
  })
}

export async function runItemDesignCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  open = false,
  json = false,
): Promise<number> {
  if (!itemRef) return missingItemRef("item design")
  return withRepos(async repos => {
    const ctx = resolveItemCompletedRun(repos, itemRef, workspaceKey, json)
    if (!ctx.ok) return ctx.code
    const { item, run } = ctx
    const artifact = readArtifactJson<DesignArtifact>(repos, run.id, "frontend-design", "design.json")
    if (!artifact) {
      return printItemCommandError(json, 3, `no design-prep artifacts for ${item.code} (hasUi=false)`, `  no design-prep artifacts for ${item.code} (hasUi=false)`)
    }
    const previewPath = artifactPath(repos, run.id, "frontend-design", "design-preview.html")
    if (json) {
      jsonOut({ itemId: item.id, runId: run.id, ...artifact, previewPath }, false)
      maybeOpenFile(previewPath, open)
      return 0
    }
    console.log(`  tone: ${artifact.tone}`)
    console.log(`  light.primary: ${artifact.tokens.light.primary}`)
    console.log(`  light.accent: ${artifact.tokens.light.accent}`)
    console.log(`  display: ${artifact.typography.display.family}`)
    console.log(`  body: ${artifact.typography.body.family}`)
    console.log(`  spacing.baseUnit: ${artifact.spacing.baseUnit}`)
    console.log(`  design-preview: ${previewPath}`)
    maybeOpenFile(previewPath, open)
    return 0
  })
}

export async function runRunListCommand(workspaceKey: string | undefined, all = false, json = false, compact = false): Promise<number> {
  return withRepos(async repos => {
    const selected = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
    const rows = listRunRows(repos, workspaceKey, all)
    if (json) return jsonOut(rows)
    console.log(all ? "  Runs across all workspaces" : `  Runs for workspace ${selected?.key ?? "—"}`)
    printRunRows(rows, compact)
    return 0
  })
}

export async function runRunGetCommand(runId: string | undefined, json = false): Promise<number> {
  if (!runId) return missingRunId("run get")
  return withRepos(async repos => {
    const run = repos.getRun(runId)
    if (!run) return notFoundRun(runId)
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
    if (json) return jsonOut(payload)
    console.log(`  ${run.id}`)
    console.log(`  workspace: ${workspace?.key ?? "—"}`)
    console.log(`  item: ${item?.code ?? "—"}  ${item?.title ?? "—"}`)
    console.log(`  stage/status: ${run.current_stage ?? "—"} / ${deriveRunStatus(run, Boolean(prompt))}`)
    if (openChat) console.log(`  open chat: ${openChat}`)
    console.log(`  stage runs: ${payload.stageRunCount}`)
    console.log(`  artifacts: ${payload.artifactCount}`)
    return 0
  })
}

export async function runChatAnswerCommand(cmd: Extract<Command, { kind: "chat-answer" }>): Promise<number> {
  const { recordAnswer } = await import("../../core/conversation.js")
  return withRepos(async repos => {
    let prompt
    if (cmd.promptId) prompt = repos.getPendingPrompt(cmd.promptId)
    else if (cmd.runId) prompt = repos.getOpenPrompt(cmd.runId)
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
    if (cmd.json) return jsonOut(result.conversation)
    console.log(`  answered ${prompt.id}`)
    console.log(`  run: ${prompt.run_id}`)
    if (cmd.runId) console.log("  target: latest open prompt for run")
    return 0
  })
}

export async function runChatSendCommand(cmd: Extract<Command, { kind: "chat-send" }>): Promise<number> {
  const { recordUserMessage } = await import("../../core/conversation.js")
  if (!cmd.runId || !cmd.text) {
    console.error("  Usage: beerengineer chat send <run-id> <text>")
    return EXIT_USAGE
  }
  return withRepos(async repos => {
    const result = recordUserMessage(repos, {
      runId: cmd.runId!,
      text: cmd.text!,
      source: "cli",
    })
    if (!result.ok) {
      console.error(`  Could not send message: ${result.code}`)
      return EXIT_USAGE
    }
    const entry = projectStageLogRow(repos.listLogsForRun(cmd.runId!).find(row => row.id === result.entryId)!)
    if (cmd.json) return jsonOut(entry ?? { id: result.entryId, runId: cmd.runId })
    console.log(`  sent ${result.entryId}`)
    console.log(`  run: ${cmd.runId}`)
    return 0
  })
}

export async function runRunMessagesCommand(cmd: Extract<Command, { kind: "run-messages" }>): Promise<number> {
  if (!cmd.runId) return missingRunId("runs messages", EXIT_USAGE)
  return withRepos(async repos => {
    const run = repos.getRun(cmd.runId!)
    if (!run) return notFoundRun(cmd.runId!)
    const result = listProjectedMessages(repos, {
      runId: cmd.runId!,
      level: cmd.level,
      since: cmd.since,
      limit: cmd.limit,
    })
    if (cmd.json) return jsonOut({ runId: cmd.runId, schema: "messages-v1", nextSince: result.nextSince, entries: result.entries })
    console.log(`  messages ${run.id}  ${run.title}`)
    result.entries.forEach(printMessageEntry)
    return 0
  })
}

export async function runRunTailCommand(cmd: Extract<Command, { kind: "run-tail" }>): Promise<number> {
  if (!cmd.runId) return missingRunId("runs tail", EXIT_USAGE)
  return withRepos(repos => runRunTail(repos, { runId: cmd.runId!, level: cmd.level, since: cmd.since, json: cmd.json }))
}

export async function runRunWatchCommand(cmd: Extract<Command, { kind: "run-watch" }>): Promise<number> {
  const runId = cmd.runId
  if (!runId) return missingRunId("runs watch", EXIT_USAGE)
  return withRepos(async repos => {
    const run = repos.getRun(runId)
    if (!run) return notFoundRun(runId)
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
    const terminalFromHistory = result.entries.map(entry => terminalExitCodeForEntry(entry)).find(code => code !== null)
    if (terminalFromHistory !== undefined) {
      if (!cmd.json) {
        const refreshed = repos.getRun(run.id)
        console.log(`  done  ${refreshed?.current_stage ?? "—"} / ${refreshed?.status ?? "unknown"}`)
      }
      return terminalFromHistory ?? 0
    }
    const tailCode = await runRunTail(repos, {
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
  })
}

export async function runItemOpenCommand(itemRef: string | undefined, workspaceKey: string | undefined): Promise<number> {
  if (!itemRef) return missingItemRef("item open")
  return withRepos(async repos => {
    const workspace = resolveSelectedWorkspace(repos, workspaceKey)
    if (!workspace) return 1
    const item = findItemByRef(repos, workspace.id, itemRef)
    if (!item) return notFoundItem(itemRef)
    await openOrPrintUrl(`${resolvePublicBaseUrl()}/?workspace=${encodeURIComponent(workspace.key)}&item=${encodeURIComponent(item.code)}`)
    return 0
  })
}

export async function runItemPreviewCommand(
  itemRef: string | undefined,
  workspaceKey: string | undefined,
  opts: { start?: boolean; stop?: boolean; open?: boolean; json?: boolean },
): Promise<number> {
  if (!itemRef) return missingItemRef("item preview")
  if (opts.start && opts.stop) {
    console.error("  Use either --start or --stop, not both")
    return 2
  }
  return withRepos(async repos => {
    const resolved = resolveCliItem(repos, itemRef, workspaceKey)
    if (!resolved) {
      console.error(`  Item not found: ${itemRef}`)
      return 1
    }
    const preview = resolveItemPreview(repos, resolved.item.id)
    if (!preview.ok) {
      console.error(`  ${preview.error}`)
      return 1
    }
    const launch = resolvePreviewLaunch(preview.worktreePath)
    const previewState = await resolvePreviewState(preview, opts)
    if (!previewState) return 1
    const payload = buildPreviewPayload(resolved, preview, launch, previewState)
    if (opts.json) {
      jsonOut(payload)
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
    if (opts.open && (payload.status === "started" || payload.status === "already_running")) openBrowser(preview.previewUrl)
    return 0
  })
}

export async function runRunOpenCommand(runId: string | undefined): Promise<number> {
  if (!runId) return missingRunId("run open")
  return withRepos(async repos => {
    if (!repos.getRun(runId)) return notFoundRun(runId)
    await openOrPrintUrl(`${resolvePublicBaseUrl()}/runs/${encodeURIComponent(runId)}`)
    return 0
  })
}

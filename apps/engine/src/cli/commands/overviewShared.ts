import { latestCompletedRunForItem } from "../../core/itemWorkspace.js"
import { Repos } from "../../db/repositories.js"
import {
  deriveItemStatus,
  deriveRunStatus,
  gitState,
  itemSortWeight,
  latestRunForItem,
  openBrowser,
  printItemCommandError,
  promptDisplayText,
  resolveSelectedWorkspace,
  runSortWeight,
  shortRunId,
  truncate,
  isUiReachable,
} from "../common.js"

export type ItemRow = {
  workspaceKey?: string
  code: string
  title: string
  stage: string
  status: string
}

export type ChatRow = {
  workspaceKey?: string
  itemCode: string
  itemTitle: string
  stage: string
  status: string
  prompt: string
  runId: string
}

export type RunRow = {
  workspaceKey?: string
  runId: string
  itemCode: string
  itemTitle: string
  stage: string
  status: string
  owner: string
}

export type WorkspaceStatusRow = {
  workspace: string
  state: string
  itemCount: number
  runCount: number
  chatCount: number
  latest: string
}

export function jsonOut(payload: unknown, pretty = true): 0 {
  process.stdout.write(`${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`)
  return 0
}

export function missingItemRef(verb: string): number {
  console.error(`  Missing item reference: beerengineer ${verb} <id|code>`)
  return 2
}

export function notFoundItem(itemRef: string): number {
  console.error(`  Item not found: ${itemRef}`)
  return 1
}

export function missingRunId(verb: string, exitCode = 2): number {
  console.error(`  Missing run id: beerengineer ${verb} <run-id>`)
  return exitCode
}

export function notFoundRun(runId: string): number {
  console.error(`  Run not found: ${runId}`)
  return 1
}

export function findItemByRef(repos: Repos, workspaceId: string, ref: string) {
  return repos.getItemByCode(workspaceId, ref) ?? repos.getItem(ref)
}

export function workspaceState<R extends { recovery_status: unknown; status: unknown }>(
  runs: R[],
  hasOpenPrompts: boolean,
): string {
  if (hasOpenPrompts) return "needs_answer"
  if (runs.some(r => r.recovery_status === "blocked")) return "blocked"
  if (runs.some(r => r.status === "running")) return "running"
  return "idle"
}

export async function openOrPrintUrl(url: string): Promise<void> {
  console.log(`  ${url}`)
  if (await isUiReachable(url)) openBrowser(url)
  else console.log("  UI is not reachable on that address; printed URL only.")
}

export function resolveItemCompletedRun(
  repos: Repos,
  itemRef: string,
  workspaceKey: string | undefined,
  json: boolean,
) {
  const workspace = resolveSelectedWorkspace(repos, workspaceKey)
  if (!workspace) return { ok: false as const, code: 2 }
  const item = findItemByRef(repos, workspace.id, itemRef)
  if (!item) {
    return {
      ok: false as const,
      code: printItemCommandError(json, 2, `item not found: ${itemRef}`, `  Item not found: ${itemRef}`),
    }
  }
  const run = latestCompletedRunForItem(repos, item.id)
  if (!run) {
    return {
      ok: false as const,
      code: printItemCommandError(json, 3, `no completed run for ${item.code}`, `  no completed run for ${item.code}`),
    }
  }
  return { ok: true as const, item, run }
}

export function maybeOpenFile(path: string | null, open: boolean): void {
  if (open) openBrowser(`file://${path}`)
}

export function listItemRows(repos: Repos, workspaceKey: string | undefined, all: boolean): ItemRow[] {
  const selectedWorkspace = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
  let workspaces = repos.listWorkspaces()
  if (!all) workspaces = selectedWorkspace ? [selectedWorkspace] : []
  return workspaces
    .flatMap(workspace => {
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
    })
    .sort((a, b) => itemSortWeight(a.status) - itemSortWeight(b.status) || a.sortCreatedAt - b.sortCreatedAt)
}

export function printItemRows(rows: ItemRow[], compact = false): void {
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

export function listChatRows(repos: Repos, workspaceKey: string | undefined, all: boolean): ChatRow[] {
  const workspace = all ? undefined : resolveSelectedWorkspace(repos, workspaceKey)
  return repos.listOpenPrompts(workspace ? { workspaceId: workspace.id } : {})
    .map(prompt => ({
      workspaceKey: prompt.workspace_key,
      itemCode: prompt.item_code,
      itemTitle: prompt.item_title,
      stage: prompt.current_stage ?? "—",
      status: "needs_answer",
      prompt: promptDisplayText(repos, prompt),
      runId: prompt.run_id,
      createdAt: prompt.created_at,
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function printChatRows(rows: ChatRow[], compact = false): void {
  if (compact) {
    console.log("  workspace  item      title                           stage/status             prompt")
    rows.forEach(row => {
      const stageStatus = `${row.stage} / ${row.status}`
      console.log(`  ${(row.workspaceKey ?? "").padEnd(9)} ${row.itemCode} ${truncate(row.itemTitle, 60)}  ${stageStatus.padEnd(24)}  ${truncate(row.prompt, 70)}`)
    })
    return
  }
  rows.forEach(row => {
    const prefix = row.workspaceKey ? `${row.workspaceKey}  ` : ""
    console.log(`  ${prefix}${row.itemCode}  ${row.itemTitle}`)
    console.log(`    ${row.stage} / ${row.status}`)
    console.log(`    prompt: ${row.prompt}`)
    console.log(`    run: ${row.runId}`)
  })
}

export function listWorkspaceStatusRows(repos: Repos): WorkspaceStatusRow[] {
  const workspaces = repos.listWorkspaces()
  const promptRows = repos.listOpenPrompts()
  return workspaces
    .map(workspace => {
      const items = repos.listItemsForWorkspace(workspace.id)
      const runs = repos.listRuns().filter(run => run.workspace_id === workspace.id)
      const chats = promptRows.filter(prompt => prompt.workspace_id === workspace.id)
      const latestRun = [...runs].sort((a, b) => b.created_at - a.created_at)[0]
      return {
        workspace: workspace.key,
        state: workspaceState(runs, chats.length > 0),
        itemCount: items.length,
        runCount: runs.length,
        chatCount: chats.length,
        latest: latestRun ? `${latestRun.current_stage ?? "—"} / run/${shortRunId(latestRun.id)}` : "idle",
      }
    })
    .sort((a, b) => itemSortWeight(a.state) - itemSortWeight(b.state) || a.workspace.localeCompare(b.workspace))
}

export function listRunRows(repos: Repos, workspaceKey: string | undefined, all: boolean): RunRow[] {
  const workspaces = new Map(repos.listWorkspaces().map(workspace => [workspace.id, workspace]))
  const selected = all ? null : resolveSelectedWorkspace(repos, workspaceKey)
  const prompts = repos.listOpenPrompts(selected ? { workspaceId: selected.id } : {})
  const promptRunIds = new Set(prompts.map(prompt => prompt.run_id))
  const items = new Map(
    (selected ? repos.listItemsForWorkspace(selected.id) : Array.from(workspaces.keys()).flatMap(id => repos.listItemsForWorkspace(id)))
      .map(item => [item.id, item]),
  )
  return repos.listRuns()
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
}

export function printRunRows(rows: RunRow[], compact = false): void {
  if (compact) {
    console.log("  workspace  run       item      title                           stage/status/owner")
    rows.forEach(row => {
      console.log(`  ${(row.workspaceKey ?? "").padEnd(9)} ${row.runId} ${row.itemCode} ${truncate(row.itemTitle ?? "—", 60)}  ${row.stage} / ${row.status} / ${row.owner}`)
    })
    return
  }
  rows.forEach(row => {
    const prefix = row.workspaceKey ? `${row.workspaceKey}  ` : ""
    console.log(`  ${prefix}run/${row.runId}  ${row.itemCode}  ${row.itemTitle}`)
    console.log(`    ${row.stage} / ${row.status} / ${row.owner}`)
  })
}

export function describeWorkspaceGit(rootPath: string | null): string {
  return gitState(rootPath)
}

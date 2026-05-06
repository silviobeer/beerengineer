import type { Repos } from "../db/repositories.js"
import { itemSlug } from "../core/itemIdentity.js"
import type { Db } from "../db/connection.js"
import { previewUrlForWorktree } from "../core/portAllocator.js"
import { layout } from "../core/workspaceLayout.js"
import { parseSupabaseReadinessRecoveryPayload } from "../core/supabase/recoveryPayload.js"
import type { SupabaseReadinessSetupAction } from "../core/supabase/types.js"

const orderedColumns = ["idea", "brainstorm", "frontend", "requirements", "implementation", "merge", "done"] as const
const columnTitles: Record<(typeof orderedColumns)[number], string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  frontend: "Frontend",
  requirements: "Requirements",
  implementation: "Implementation",
  merge: "Merge",
  done: "Done"
}

function itemWorktreePath(rootPath: string | null, workspaceFsId: string | null, itemTitle: string, itemId: string): string | null {
  if (!rootPath || !workspaceFsId) return null
  const slug = itemSlug({ id: itemId, title: itemTitle })
  return layout.itemWorktreeDir({
    workspaceId: workspaceFsId,
    workspaceRoot: rootPath,
    itemSlug: slug,
    runId: workspaceFsId,
  })
}

function reviewGateWaiting(actionsJson: string | null | undefined): boolean {
  if (!actionsJson) return false
  try {
    const actions = JSON.parse(actionsJson) as Array<{ value?: unknown }>
    return actions.some(action => action?.value === "promote")
  } catch {
    return false
  }
}

function supabaseBlocker(
  workspace: { id: string; key: string },
  latestRun: { id: string; recovery_status: string | null; recovery_summary: string | null; recovery_payload_json: string | null } | undefined,
): BoardCardDTO["supabaseBlocker"] {
  if (latestRun?.recovery_status !== "blocked") return undefined
  const payload = parseSupabaseReadinessRecoveryPayload(latestRun.recovery_payload_json)
  if (!payload) return undefined
  const missingSetupActions = payload.missingSetupActions
  return {
    status: "blocked",
    label: "Supabase blocked",
    runId: latestRun.id,
    workspace: { id: payload.workspace.id ?? workspace.id, key: payload.workspace.key ?? workspace.key },
    missingSetupActions,
    message: latestRun.recovery_summary ?? payload.message,
    retry: { available: payload.retry.available, ready: missingSetupActions.length === 0 },
  }
}

function boardCardMeta(
  workspaceRoot: string | null,
  latestRun: { id: string; workspace_fs_id: string | null; recovery_status: string | null } | undefined,
  openPrompt: { actions_json: string | null } | undefined,
  item: { title: string; id: string },
): Pick<BoardCardDTO, "hasOpenPrompt" | "hasReviewGateWaiting" | "hasBlockedRun" | "previewUrl"> {
  const worktreePath = itemWorktreePath(workspaceRoot, latestRun?.workspace_fs_id ?? null, item.title, item.id)
  return {
    hasOpenPrompt: Boolean(openPrompt),
    hasReviewGateWaiting: reviewGateWaiting(openPrompt?.actions_json),
    hasBlockedRun: latestRun?.recovery_status === "blocked",
    previewUrl: worktreePath ? previewUrlForWorktree(worktreePath) : undefined,
  }
}

export type BoardCardDTO = {
  itemCode: string
  itemId: string
  title: string
  summary: string
  column: (typeof orderedColumns)[number]
  phaseStatus: string
  /** Engine stageKey of the authoritative run, null when no live stage. */
  currentStage: string | null
  hasOpenPrompt?: boolean
  hasReviewGateWaiting?: boolean
  hasBlockedRun?: boolean
  supabaseBlocker?: {
    status: "blocked" | "ready" | "checking"
    label: "Supabase blocked"
    runId: string
    workspace: { id?: string; key?: string }
    missingSetupActions: SupabaseReadinessSetupAction[]
    message?: string
    retry: { available: boolean; ready: boolean }
  }
  previewUrl?: string
  latestRunId?: string
  workspaceId?: string
  workspaceRoot?: string | null
  supabaseProjectRef?: string | null
  dbRelevance?: { value: boolean; source: "detector"; reason: string }
  supabaseBranch?: { ref: string; name: string; lifecycleState: string | null }
  meta: Array<{ label: string; value: string }>
}

export type BoardColumnDTO = {
  key: (typeof orderedColumns)[number]
  title: string
  cards: BoardCardDTO[]
}

export type BoardDTO = {
  workspaceKey: string | null
  columns: BoardColumnDTO[]
  costRisk: {
    retainedBranchCount: number
    planLimitRatio: number
  }
}

function workspaceCostRisk(db: Db, workspaceId?: string): BoardDTO["costRisk"] {
  if (!workspaceId) return { retainedBranchCount: 0, planLimitRatio: 0 }
  const retained = db.prepare(
    "SELECT COUNT(*) AS n FROM runs WHERE workspace_id = ? AND supabase_branch_lifecycle_state IN ('retained-for-diagnosis', 'quota-exceeded')"
  ).get(workspaceId) as { n: number } | undefined
  const quota = db.prepare("SELECT supabase_branch_quota_usage, supabase_branch_quota_limit FROM workspaces WHERE id = ?").get(workspaceId) as { supabase_branch_quota_usage: number | null; supabase_branch_quota_limit: number | null } | undefined
  return {
    retainedBranchCount: retained?.n ?? 0,
    planLimitRatio: quota?.supabase_branch_quota_usage != null && quota.supabase_branch_quota_limit
      ? quota.supabase_branch_quota_usage / quota.supabase_branch_quota_limit
      : 0,
  }
}

export function getBoard(db: Db, workspaceKey?: string | null): BoardDTO {
  const workspace = workspaceKey
    ? (db.prepare("SELECT * FROM workspaces WHERE key = ?").get(workspaceKey) as { id: string; key: string; root_path: string | null; supabase_project_ref: string | null } | undefined)
    : (db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as { id: string; key: string; root_path: string | null; supabase_project_ref: string | null } | undefined)

  if (!workspace) {
    return {
      workspaceKey: workspaceKey ?? null,
      columns: orderedColumns.map(key => ({ key, title: columnTitles[key], cards: [] })),
      costRisk: { retainedBranchCount: 0, planLimitRatio: 0 },
    }
  }

  const items = db
    .prepare(
      `SELECT id, workspace_id, code, title, description, current_column, phase_status, current_stage
       FROM items WHERE workspace_id = ? ORDER BY created_at ASC`
    )
    .all(workspace.id) as Array<{
      id: string
      workspace_id: string
      code: string
      title: string
      description: string
      current_column: (typeof orderedColumns)[number]
      phase_status: string
      current_stage: string | null
    }>

  const projectCounts = new Map<string, number>()
  const projectRows = db
    .prepare(
      `SELECT item_id, COUNT(*) as count FROM projects
       WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?)
       GROUP BY item_id`
    )
    .all(workspace.id) as Array<{ item_id: string; count: number }>
  for (const row of projectRows) projectCounts.set(row.item_id, row.count)

  const latestRuns = new Map<string, {
    id: string
    item_id: string
    status: string
    recovery_status: string | null
    recovery_scope_ref: string | null
    recovery_summary: string | null
    recovery_payload_json: string | null
    workspace_fs_id: string | null
    supabase_branch_ref: string | null
    supabase_branch_name: string | null
    supabase_branch_lifecycle_state: string | null
  }>()
  const runRows = db
    .prepare(
      `SELECT id, item_id, status, recovery_status, recovery_scope_ref, recovery_summary, recovery_payload_json, workspace_fs_id,
              supabase_branch_ref, supabase_branch_name, supabase_branch_lifecycle_state, created_at
       FROM runs
       WHERE workspace_id = ?
       ORDER BY created_at DESC`
    )
    .all(workspace.id) as Array<{
      id: string
      item_id: string
      status: string
      recovery_status: string | null
      recovery_scope_ref: string | null
      recovery_summary: string | null
      recovery_payload_json: string | null
      workspace_fs_id: string | null
      supabase_branch_ref: string | null
      supabase_branch_name: string | null
      supabase_branch_lifecycle_state: string | null
      created_at: number
    }>
  for (const run of runRows) {
    if (!latestRuns.has(run.item_id)) latestRuns.set(run.item_id, run)
  }

  const openPromptsByRun = new Map<string, { actions_json: string | null }>()
  const promptRows = db
    .prepare(
      `SELECT p.run_id, p.actions_json
       FROM pending_prompts p
       JOIN runs r ON r.id = p.run_id
       WHERE p.answered_at IS NULL
         AND r.workspace_id = ?`
    )
    .all(workspace.id) as Array<{ run_id: string; actions_json: string | null }>
  for (const row of promptRows) {
    if (!openPromptsByRun.has(row.run_id)) openPromptsByRun.set(row.run_id, row)
  }

  return {
    workspaceKey: workspace.key,
    costRisk: workspaceCostRisk(db, workspace.id),
    columns: orderedColumns.map(col => ({
      key: col,
      title: columnTitles[col],
      cards: items
        .filter(i => i.current_column === col)
        .map<BoardCardDTO>(i => {
          const latestRun = latestRuns.get(i.id)
          const openPrompt = latestRun ? openPromptsByRun.get(latestRun.id) : undefined
          const supabaseBranch = latestRun?.supabase_branch_ref
            ? {
                ref: latestRun.supabase_branch_ref,
                name: latestRun.supabase_branch_name ?? latestRun.supabase_branch_ref,
                lifecycleState: latestRun.supabase_branch_lifecycle_state,
              }
            : undefined
          return {
          ...boardCardMeta(workspace.root_path ?? null, latestRun, openPrompt, { title: i.title, id: i.id }),
          supabaseBlocker: supabaseBlocker(workspace, latestRun),
          itemCode: i.code,
          itemId: i.id,
          title: i.title,
          summary: i.description,
          column: i.current_column,
          phaseStatus: i.phase_status,
          currentStage: i.current_stage ?? null,
          latestRunId: latestRun?.id,
          workspaceId: workspace.id,
          workspaceRoot: workspace.root_path ?? null,
          supabaseProjectRef: workspace.supabase_project_ref ?? null,
          dbRelevance: {
            value: Boolean(supabaseBranch),
            source: "detector" as const,
            reason: supabaseBranch ? "Supabase branch provisioned" : "No Supabase branch provisioned",
          },
          supabaseBranch,
          meta: [
            { label: "phase", value: i.phase_status },
            { label: "projects", value: String(projectCounts.get(i.id) ?? 0) }
          ]
        }})
    }))
  }
}

export function getRunTree(repos: Repos, runId: string) {
  const run = repos.getRun(runId)
  if (!run) return null
  const stageRuns = repos.listStageRunsForRun(runId)
  const artifacts = repos.listArtifactsForRun(runId)
  return { run, stageRuns, artifacts }
}

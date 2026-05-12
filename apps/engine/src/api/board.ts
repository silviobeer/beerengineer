import { Repos } from "../db/repositories.js"
import type { Db } from "../db/connection.js"
import {
  VISIBLE_ACTION_FACTS_FRESHNESS,
  visibleActionsForItem,
} from "../core/itemActions.js"
import { isStructuredMergeConflictRecoveryRun } from "../core/mergeConflictRecovery.js"
import {
  CHAT_ENTRY_FACT_FRESHNESS,
  MESSAGES_ENTRY_FACT_FRESHNESS,
  runEntryFactsForItem,
} from "../core/itemRunEntryFacts.js"
import { buildRunArtifactReadModels } from "./artifactReadModel.js"
import { createDefaultBoardProjectionCoordinator } from "./boardProjectionCoordinator.js"
import { orderedBoardColumns, type BoardCardDTO, type BoardDTO, type BoardItemRow, type BoardLatestRun, type BoardOpenPrompt, type BoardWorkspace } from "./boardProjectionTypes.js"

const columnTitles: Record<(typeof orderedBoardColumns)[number], string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  frontend: "Frontend",
  requirements: "Requirements",
  implementation: "Implementation",
  merge: "Merge",
  done: "Done"
}
export type { BoardCardDTO, BoardColumnDTO, BoardDTO } from "./boardProjectionTypes.js"

const boardProjectionCoordinator = createDefaultBoardProjectionCoordinator()

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
  const repos = new Repos(db)
  const workspace: BoardWorkspace | undefined = workspaceKey
    ? (db.prepare("SELECT * FROM workspaces WHERE key = ?").get(workspaceKey) as { id: string; key: string; root_path: string | null; supabase_project_ref: string | null } | undefined)
    : (db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as { id: string; key: string; root_path: string | null; supabase_project_ref: string | null } | undefined)

  if (!workspace) {
    return {
      workspaceKey: workspaceKey ?? null,
      columns: orderedBoardColumns.map(key => ({ key, title: columnTitles[key], cards: [] })),
      costRisk: { retainedBranchCount: 0, planLimitRatio: 0 },
    }
  }

  const items = db
    .prepare(
      `SELECT id, workspace_id, code, title, description, current_column, phase_status, current_stage
       FROM items WHERE workspace_id = ? ORDER BY created_at ASC`
    )
    .all(workspace.id) as BoardItemRow[]

  const projectCounts = new Map<string, number>()
  const projectRows = db
    .prepare(
      `SELECT item_id, COUNT(*) as count FROM projects
       WHERE item_id IN (SELECT id FROM items WHERE workspace_id = ?)
       GROUP BY item_id`
    )
    .all(workspace.id) as Array<{ item_id: string; count: number }>
  for (const row of projectRows) projectCounts.set(row.item_id, row.count)

  const latestRuns = new Map<string, BoardLatestRun>()
  const runRows = db
    .prepare(
      `SELECT id, item_id, status, recovery_status, recovery_scope_ref, recovery_summary, recovery_payload_json, workspace_fs_id,
              supabase_branch_ref, supabase_branch_name, supabase_branch_lifecycle_state, created_at
       FROM runs
       WHERE workspace_id = ?
       ORDER BY created_at DESC`
    )
    .all(workspace.id) as Array<BoardLatestRun & { created_at: number }>
  for (const run of runRows) {
    if (!latestRuns.has(run.item_id)) latestRuns.set(run.item_id, run)
  }

  const openPromptsByRun = new Map<string, BoardOpenPrompt>()
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
    columns: orderedBoardColumns.map(col => ({
      key: col,
      title: columnTitles[col],
      cards: items
        .filter(i => i.current_column === col)
        .map<BoardCardDTO>(i => {
          const latestRun = latestRuns.get(i.id)
          const openPrompt = latestRun ? openPromptsByRun.get(latestRun.id) : undefined
          const baseCard = boardProjectionCoordinator.projectCard({
            workspace,
            item: i,
            latestRun,
            openPrompt,
            projectCount: projectCounts.get(i.id) ?? 0,
          })
          const entryFacts = runEntryFactsForItem(repos, i.id)
          return {
            ...baseCard,
            chatEntry: entryFacts.chatEntry,
            chatEntryFreshness: entryFacts.chatEntryFreshness,
            messagesEntry: entryFacts.messagesEntry,
            messagesEntryFreshness: entryFacts.messagesEntryFreshness,
            visibleActions: visibleActionsForItem({
              column: baseCard.column,
              phase: baseCard.phaseStatus,
              currentStage: baseCard.currentStage ?? null,
              hasOpenPrompt: baseCard.hasOpenPrompt,
              hasReviewGateWaiting: baseCard.hasReviewGateWaiting,
              hasBlockedRun: baseCard.hasBlockedRun,
              hasMergeConflictBlockedRun: isStructuredMergeConflictRecoveryRun(latestRun),
            }),
            visibleActionsFreshness: VISIBLE_ACTION_FACTS_FRESHNESS,
          }
        })
    }))
  }
}

export function getRunTree(repos: Repos, runId: string) {
  const run = repos.getRun(runId)
  if (!run) return null
  const stageRuns = repos.listStageRunsForRun(runId)
  const artifacts = repos.listArtifactsForRun(runId)
  return {
    run,
    stageRuns,
    artifacts: buildRunArtifactReadModels(artifacts),
  }
}

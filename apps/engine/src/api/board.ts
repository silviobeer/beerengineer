import type { Repos } from "../db/repositories.js"
import type { Db } from "../db/connection.js"

const orderedColumns = ["idea", "brainstorm", "requirements", "implementation", "done"] as const
const columnTitles: Record<(typeof orderedColumns)[number], string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  requirements: "Requirements",
  implementation: "Implementation",
  done: "Done"
}

export type BoardCardDTO = {
  itemCode: string
  itemId: string
  title: string
  summary: string
  column: (typeof orderedColumns)[number]
  phaseStatus: string
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
}

export function getBoard(db: Db, workspaceKey?: string | null): BoardDTO {
  const workspace = workspaceKey
    ? (db.prepare("SELECT * FROM workspaces WHERE key = ?").get(workspaceKey) as { id: string; key: string } | undefined)
    : (db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as { id: string; key: string } | undefined)

  if (!workspace) {
    return {
      workspaceKey: workspaceKey ?? null,
      columns: orderedColumns.map(key => ({ key, title: columnTitles[key], cards: [] }))
    }
  }

  const items = db
    .prepare(
      `SELECT id, workspace_id, code, title, description, current_column, phase_status
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

  return {
    workspaceKey: workspace.key,
    columns: orderedColumns.map(col => ({
      key: col,
      title: columnTitles[col],
      cards: items
        .filter(i => i.current_column === col)
        .map<BoardCardDTO>(i => ({
          itemCode: i.code,
          itemId: i.id,
          title: i.title,
          summary: i.description,
          column: i.current_column,
          phaseStatus: i.phase_status,
          meta: [
            { label: "phase", value: i.phase_status },
            { label: "projects", value: String(projectCounts.get(i.id) ?? 0) }
          ]
        }))
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

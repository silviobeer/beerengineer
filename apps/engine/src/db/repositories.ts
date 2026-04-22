import { randomUUID } from "node:crypto"
import type { Db } from "./connection.js"

const now = () => Date.now()

export type WorkspaceRow = {
  id: string
  key: string
  name: string
  description: string | null
  root_path: string | null
  created_at: number
  updated_at: number
}

export type ItemRow = {
  id: string
  workspace_id: string
  code: string
  title: string
  description: string
  current_column: "idea" | "brainstorm" | "requirements" | "implementation" | "done"
  phase_status: "draft" | "running" | "review_required" | "completed" | "failed"
  created_at: number
  updated_at: number
}

export type ProjectRow = {
  id: string
  item_id: string
  code: string
  name: string
  summary: string
  status: string
  position: number
  created_at: number
  updated_at: number
}

export type RunOwner = "cli" | "api"

export type RunRow = {
  id: string
  workspace_id: string
  item_id: string
  title: string
  status: string
  current_stage: string | null
  owner: RunOwner
  created_at: number
  updated_at: number
}

export type StageRunRow = {
  id: string
  run_id: string
  project_id: string | null
  stage_key: string
  status: string
  started_at: number | null
  completed_at: number | null
  error_message: string | null
  created_at: number
  updated_at: number
}

export type StageLogRow = {
  id: string
  run_id: string
  stage_run_id: string | null
  event_type: string
  message: string
  data_json: string | null
  created_at: number
}

export type ArtifactFileRow = {
  id: string
  run_id: string | null
  stage_run_id: string | null
  project_id: string | null
  label: string
  kind: string
  path: string
  created_at: number
}

export type PendingPromptRow = {
  id: string
  run_id: string
  stage_run_id: string | null
  prompt: string
  answer: string | null
  created_at: number
  answered_at: number | null
}

export class Repos {
  constructor(private readonly db: Db) {}

  upsertWorkspace(input: { key: string; name: string; description?: string | null }): WorkspaceRow {
    const existing = this.db
      .prepare("SELECT * FROM workspaces WHERE key = ?")
      .get(input.key) as WorkspaceRow | undefined
    if (existing) return existing
    const row: WorkspaceRow = {
      id: randomUUID(),
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      root_path: null,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
         VALUES (@id, @key, @name, @description, @root_path, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  /**
   * Mint the next monotonically increasing item code (`ITEM-####`) for a
   * workspace. Scans existing rows so the sequence survives process restarts
   * and shared DB access from CLI + API.
   */
  nextItemCode(workspaceId: string): string {
    const rows = this.db
      .prepare("SELECT code FROM items WHERE workspace_id = ? AND code LIKE 'ITEM-%'")
      .all(workspaceId) as Array<{ code: string }>
    let max = 0
    for (const { code } of rows) {
      const m = /^ITEM-(\d+)$/.exec(code)
      if (m) {
        const n = Number(m[1])
        if (Number.isFinite(n) && n > max) max = n
      }
    }
    return `ITEM-${String(max + 1).padStart(4, "0")}`
  }

  getItem(id: string): ItemRow | undefined {
    return this.db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined
  }

  getItemByCode(workspaceId: string, code: string): ItemRow | undefined {
    return this.db
      .prepare("SELECT * FROM items WHERE workspace_id = ? AND code = ?")
      .get(workspaceId, code) as ItemRow | undefined
  }

  findItemsByCode(code: string): ItemRow[] {
    return this.db
      .prepare("SELECT * FROM items WHERE code = ? ORDER BY created_at ASC")
      .all(code) as ItemRow[]
  }

  latestActiveRunForItem(itemId: string): RunRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE item_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
      )
      .get(itemId) as RunRow | undefined
  }

  createItem(input: {
    workspaceId: string
    code?: string
    title: string
    description: string
  }): ItemRow {
    const id = randomUUID()
    const code = input.code ?? this.nextItemCode(input.workspaceId)
    const row: ItemRow = {
      id,
      workspace_id: input.workspaceId,
      code,
      title: input.title,
      description: input.description,
      current_column: "idea",
      phase_status: "draft",
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO items (id, workspace_id, code, title, description, current_column, phase_status, created_at, updated_at)
         VALUES (@id, @workspace_id, @code, @title, @description, @current_column, @phase_status, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  setItemColumn(itemId: string, column: ItemRow["current_column"], phaseStatus: ItemRow["phase_status"]): void {
    this.db
      .prepare(
        "UPDATE items SET current_column = ?, phase_status = ?, updated_at = ? WHERE id = ?"
      )
      .run(column, phaseStatus, now(), itemId)
  }

  createProject(input: { id?: string; itemId: string; code: string; name: string; summary?: string; status?: string; position?: number }): ProjectRow {
    // Idempotent only within one item: project codes like P01 are reused across
    // different items by the fake adapters, so global dedup corrupts links.
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE item_id = ? AND code = ?")
      .get(input.itemId, input.code) as ProjectRow | undefined
    if (existing) return existing
    const row: ProjectRow = {
      id: input.id ?? randomUUID(),
      item_id: input.itemId,
      code: input.code,
      name: input.name,
      summary: input.summary ?? "",
      status: input.status ?? "draft",
      position: input.position ?? 0,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO projects (id, item_id, code, name, summary, status, position, created_at, updated_at)
         VALUES (@id, @item_id, @code, @name, @summary, @status, @position, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  createRun(input: { workspaceId: string; itemId: string; title: string; owner?: RunOwner }): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      item_id: input.itemId,
      title: input.title,
      status: "running",
      current_stage: null,
      owner: input.owner ?? "api",
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO runs (id, workspace_id, item_id, title, status, current_stage, owner, created_at, updated_at)
         VALUES (@id, @workspace_id, @item_id, @title, @status, @current_stage, @owner, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  updateRun(id: string, patch: Partial<Pick<RunRow, "status" | "current_stage">>): void {
    const existing = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined
    if (!existing) return
    const next = {
      ...existing,
      ...patch,
      updated_at: now()
    }
    this.db
      .prepare("UPDATE runs SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?")
      .run(next.status, next.current_stage, next.updated_at, id)
  }

  getRun(id: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined
  }

  listRuns(): RunRow[] {
    return this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all() as RunRow[]
  }

  createStageRun(input: { id?: string; runId: string; stageKey: string; projectId?: string | null }): StageRunRow {
    const row: StageRunRow = {
      id: input.id ?? randomUUID(),
      run_id: input.runId,
      project_id: input.projectId ?? null,
      stage_key: input.stageKey,
      status: "running",
      started_at: now(),
      completed_at: null,
      error_message: null,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO stage_runs (id, run_id, project_id, stage_key, status, started_at, completed_at, error_message, created_at, updated_at)
         VALUES (@id, @run_id, @project_id, @stage_key, @status, @started_at, @completed_at, @error_message, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  completeStageRun(id: string, status: "completed" | "failed", errorMessage?: string | null): void {
    this.db
      .prepare(
        "UPDATE stage_runs SET status = ?, completed_at = ?, error_message = ?, updated_at = ? WHERE id = ?"
      )
      .run(status, now(), errorMessage ?? null, now(), id)
  }

  listStageRunsForRun(runId: string): StageRunRow[] {
    return this.db
      .prepare("SELECT * FROM stage_runs WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as StageRunRow[]
  }

  appendLog(input: {
    runId: string
    stageRunId?: string | null
    eventType: string
    message?: string
    data?: unknown
  }): StageLogRow {
    const row: StageLogRow = {
      id: randomUUID(),
      run_id: input.runId,
      stage_run_id: input.stageRunId ?? null,
      event_type: input.eventType,
      message: input.message ?? "",
      data_json: input.data === undefined ? null : JSON.stringify(input.data),
      created_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO stage_logs (id, run_id, stage_run_id, event_type, message, data_json, created_at)
         VALUES (@id, @run_id, @stage_run_id, @event_type, @message, @data_json, @created_at)`
      )
      .run(row)
    return row
  }

  listLogsForRun(runId: string, sinceCreatedAt = 0): StageLogRow[] {
    return this.db
      .prepare("SELECT * FROM stage_logs WHERE run_id = ? AND created_at >= ? ORDER BY created_at ASC, id ASC")
      .all(runId, sinceCreatedAt) as StageLogRow[]
  }

  recordArtifact(input: {
    runId?: string | null
    stageRunId?: string | null
    projectId?: string | null
    label: string
    kind: string
    path: string
  }): ArtifactFileRow {
    const row: ArtifactFileRow = {
      id: randomUUID(),
      run_id: input.runId ?? null,
      stage_run_id: input.stageRunId ?? null,
      project_id: input.projectId ?? null,
      label: input.label,
      kind: input.kind,
      path: input.path,
      created_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO artifact_files (id, run_id, stage_run_id, project_id, label, kind, path, created_at)
         VALUES (@id, @run_id, @stage_run_id, @project_id, @label, @kind, @path, @created_at)`
      )
      .run(row)
    return row
  }

  listArtifactsForRun(runId: string): ArtifactFileRow[] {
    return this.db
      .prepare("SELECT * FROM artifact_files WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as ArtifactFileRow[]
  }

  createPendingPrompt(input: { runId: string; stageRunId?: string | null; prompt: string }): PendingPromptRow {
    const row: PendingPromptRow = {
      id: randomUUID(),
      run_id: input.runId,
      stage_run_id: input.stageRunId ?? null,
      prompt: input.prompt,
      answer: null,
      created_at: now(),
      answered_at: null
    }
    this.db
      .prepare(
        `INSERT INTO pending_prompts (id, run_id, stage_run_id, prompt, answer, created_at, answered_at)
         VALUES (@id, @run_id, @stage_run_id, @prompt, @answer, @created_at, @answered_at)`
      )
      .run(row)
    return row
  }

  answerPendingPrompt(id: string, answer: string): PendingPromptRow | undefined {
    this.db
      .prepare("UPDATE pending_prompts SET answer = ?, answered_at = ? WHERE id = ? AND answered_at IS NULL")
      .run(answer, now(), id)
    return this.db.prepare("SELECT * FROM pending_prompts WHERE id = ?").get(id) as PendingPromptRow | undefined
  }

  getOpenPrompt(runId: string): PendingPromptRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM pending_prompts WHERE run_id = ? AND answered_at IS NULL ORDER BY created_at ASC LIMIT 1"
      )
      .get(runId) as PendingPromptRow | undefined
  }
}

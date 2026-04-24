import { randomUUID } from "node:crypto"
import type { Db } from "./connection.js"

const now = () => Date.now()

export type WorkspaceRow = {
  id: string
  key: string
  name: string
  description: string | null
  root_path: string | null
  harness_profile_json: string
  sonar_enabled: number
  last_opened_at: number | null
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
  recovery_status: "blocked" | "failed" | null
  recovery_scope: "run" | "stage" | "story" | null
  recovery_scope_ref: string | null
  recovery_summary: string | null
  workspace_fs_id: string | null
  created_at: number
  updated_at: number
}

export type ExternalRemediationRow = {
  id: string
  run_id: string
  scope: "run" | "stage" | "story"
  scope_ref: string | null
  summary: string
  branch: string | null
  commit_sha: string | null
  review_notes: string | null
  source: "cli" | "ui" | "api"
  actor_id: string | null
  created_at: number
}

export type StageRunRow = {
  id: string
  run_id: string
  project_id: string | null
  stage_key: string
  status: string
  stage_agent_session_id: string | null
  reviewer_session_id: string | null
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

export type OpenPromptContextRow = PendingPromptRow & {
  workspace_id: string
  workspace_key: string
  workspace_name: string
  item_id: string
  item_code: string
  item_title: string
  run_title: string
  run_status: string
  current_stage: string | null
}

export type NotificationDeliveryRow = {
  dedup_key: string
  channel: string
  chat_id: string
  status: string
  attempt_count: number
  last_attempt_at: number | null
  delivered_at: number | null
  error_message: string | null
  created_at: number
  updated_at: number
}

export class Repos {
  constructor(private readonly db: Db) {}

  upsertWorkspace(input: {
    key: string
    name: string
    description?: string | null
    rootPath?: string | null
    harnessProfileJson?: string
    sonarEnabled?: boolean
    lastOpenedAt?: number | null
  }): WorkspaceRow {
    const existing = this.db
      .prepare("SELECT * FROM workspaces WHERE key = ?")
      .get(input.key) as WorkspaceRow | undefined
    if (existing) {
      const next = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        root_path: input.rootPath ?? existing.root_path,
        harness_profile_json: input.harnessProfileJson ?? existing.harness_profile_json,
        sonar_enabled: input.sonarEnabled === undefined ? existing.sonar_enabled : input.sonarEnabled ? 1 : 0,
        last_opened_at: input.lastOpenedAt === undefined ? existing.last_opened_at : input.lastOpenedAt,
        updated_at: now(),
      }
      this.db
        .prepare(
          `UPDATE workspaces
           SET name = @name,
               description = @description,
               root_path = @root_path,
               harness_profile_json = @harness_profile_json,
               sonar_enabled = @sonar_enabled,
               last_opened_at = @last_opened_at,
               updated_at = @updated_at
           WHERE id = @id`
        )
        .run(next)
      return this.getWorkspaceByKey(input.key) as WorkspaceRow
    }
    const row: WorkspaceRow = {
      id: randomUUID(),
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      root_path: input.rootPath ?? null,
      harness_profile_json: input.harnessProfileJson ?? JSON.stringify({ mode: "claude-first" }),
      sonar_enabled: input.sonarEnabled ? 1 : 0,
      last_opened_at: input.lastOpenedAt ?? null,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO workspaces (
           id, key, name, description, root_path, harness_profile_json, sonar_enabled, last_opened_at, created_at, updated_at
         ) VALUES (
           @id, @key, @name, @description, @root_path, @harness_profile_json, @sonar_enabled, @last_opened_at, @created_at, @updated_at
         )`
      )
      .run(row)
    return row
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db.prepare("SELECT * FROM workspaces ORDER BY key ASC").all() as WorkspaceRow[]
  }

  getWorkspace(id: string): WorkspaceRow | undefined {
    return this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined
  }

  getWorkspaceByKey(key: string): WorkspaceRow | undefined {
    return this.db.prepare("SELECT * FROM workspaces WHERE key = ?").get(key) as WorkspaceRow | undefined
  }

  getWorkspaceByRootPath(rootPath: string): WorkspaceRow | undefined {
    return this.db.prepare("SELECT * FROM workspaces WHERE root_path = ?").get(rootPath) as WorkspaceRow | undefined
  }

  removeWorkspaceByKey(key: string): boolean {
    const result = this.db.prepare("DELETE FROM workspaces WHERE key = ?").run(key)
    return result.changes > 0
  }

  touchWorkspaceLastOpenedAt(key: string, timestamp = now()): void {
    this.db.prepare("UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE key = ?").run(timestamp, timestamp, key)
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

  listItemsForWorkspace(workspaceId: string): ItemRow[] {
    return this.db
      .prepare("SELECT * FROM items WHERE workspace_id = ? ORDER BY created_at ASC")
      .all(workspaceId) as ItemRow[]
  }

  latestActiveRunForItem(itemId: string): RunRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE item_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
      )
      .get(itemId) as RunRow | undefined
  }

  latestRecoverableRunForItem(itemId: string): RunRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE item_id = ? AND recovery_status IS NOT NULL ORDER BY updated_at DESC, created_at DESC LIMIT 1"
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
    const existingById = input.id
      ? this.db.prepare("SELECT * FROM projects WHERE id = ?").get(input.id) as ProjectRow | undefined
      : undefined
    const row: ProjectRow = {
      id: existingById && existingById.item_id !== input.itemId ? randomUUID() : input.id ?? randomUUID(),
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

  createRun(input: {
    workspaceId: string
    itemId: string
    title: string
    owner?: RunOwner
    workspaceFsId?: string | null
  }): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      item_id: input.itemId,
      title: input.title,
      status: "running",
      current_stage: null,
      owner: input.owner ?? "api",
      recovery_status: null,
      recovery_scope: null,
      recovery_scope_ref: null,
      recovery_summary: null,
      workspace_fs_id: input.workspaceFsId ?? null,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO runs (id, workspace_id, item_id, title, status, current_stage, owner, workspace_fs_id, created_at, updated_at)
         VALUES (@id, @workspace_id, @item_id, @title, @status, @current_stage, @owner, @workspace_fs_id, @created_at, @updated_at)`
      )
      .run({
        id: row.id,
        workspace_id: row.workspace_id,
        item_id: row.item_id,
        title: row.title,
        status: row.status,
        current_stage: row.current_stage,
        owner: row.owner,
        workspace_fs_id: row.workspace_fs_id,
        created_at: row.created_at,
        updated_at: row.updated_at
      })
    return row
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRow, "status" | "current_stage" | "recovery_status" | "recovery_scope" | "recovery_scope_ref" | "recovery_summary">>
  ): void {
    const existing = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined
    if (!existing) return
    const next = {
      ...existing,
      ...patch,
      updated_at: now()
    }
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?,
             current_stage = ?,
             recovery_status = ?,
             recovery_scope = ?,
             recovery_scope_ref = ?,
             recovery_summary = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.status,
        next.current_stage,
        next.recovery_status,
        next.recovery_scope,
        next.recovery_scope_ref,
        next.recovery_summary,
        next.updated_at,
        id,
      )
  }

  /**
   * Write the recovery projection onto a run. Pass `null` for all fields to
   * clear (used when a blocked scope resumes successfully).
   */
  setRunRecovery(
    id: string,
    patch: {
      status: RunRow["recovery_status"]
      scope: RunRow["recovery_scope"]
      scopeRef: string | null
      summary: string | null
    }
  ): void {
    this.db
      .prepare(
        `UPDATE runs
         SET recovery_status = ?, recovery_scope = ?, recovery_scope_ref = ?, recovery_summary = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(patch.status, patch.scope, patch.scopeRef, patch.summary, now(), id)
  }

  clearRunRecovery(id: string): void {
    this.setRunRecovery(id, { status: null, scope: null, scopeRef: null, summary: null })
  }

  createExternalRemediation(input: {
    id?: string
    runId: string
    scope: ExternalRemediationRow["scope"]
    scopeRef?: string | null
    summary: string
    branch?: string | null
    commitSha?: string | null
    reviewNotes?: string | null
    source: ExternalRemediationRow["source"]
    actorId?: string | null
  }): ExternalRemediationRow {
    const row: ExternalRemediationRow = {
      id: input.id ?? randomUUID(),
      run_id: input.runId,
      scope: input.scope,
      scope_ref: input.scopeRef ?? null,
      summary: input.summary,
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
      review_notes: input.reviewNotes ?? null,
      source: input.source,
      actor_id: input.actorId ?? null,
      created_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO external_remediations (id, run_id, scope, scope_ref, summary, branch, commit_sha, review_notes, source, actor_id, created_at)
         VALUES (@id, @run_id, @scope, @scope_ref, @summary, @branch, @commit_sha, @review_notes, @source, @actor_id, @created_at)`
      )
      .run(row)
    return row
  }

  latestExternalRemediation(runId: string): ExternalRemediationRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM external_remediations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(runId) as ExternalRemediationRow | undefined
  }

  listExternalRemediations(runId: string): ExternalRemediationRow[] {
    return this.db
      .prepare(
        "SELECT * FROM external_remediations WHERE run_id = ? ORDER BY created_at ASC"
      )
      .all(runId) as ExternalRemediationRow[]
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
      stage_agent_session_id: null,
      reviewer_session_id: null,
      started_at: now(),
      completed_at: null,
      error_message: null,
      created_at: now(),
      updated_at: now()
    }
    this.db
      .prepare(
        `INSERT INTO stage_runs (id, run_id, project_id, stage_key, status, stage_agent_session_id, reviewer_session_id, started_at, completed_at, error_message, created_at, updated_at)
         VALUES (@id, @run_id, @project_id, @stage_key, @status, @stage_agent_session_id, @reviewer_session_id, @started_at, @completed_at, @error_message, @created_at, @updated_at)`
      )
      .run(row)
    return row
  }

  updateStageRunSessions(id: string, sessions: { stageAgentSessionId?: string | null; reviewerSessionId?: string | null }): void {
    this.db
      .prepare(
        "UPDATE stage_runs SET stage_agent_session_id = COALESCE(?, stage_agent_session_id), reviewer_session_id = COALESCE(?, reviewer_session_id), updated_at = ? WHERE id = ?"
      )
      .run(sessions.stageAgentSessionId, sessions.reviewerSessionId, now(), id)
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
    const touchedAt = now()
    this.db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(touchedAt, input.runId)
    if (input.stageRunId) {
      this.db.prepare("UPDATE stage_runs SET updated_at = ? WHERE id = ?").run(touchedAt, input.stageRunId)
    }
    return row
  }

  listLogsForRun(runId: string, sinceCreatedAt = 0): StageLogRow[] {
    return this.db
      .prepare("SELECT * FROM stage_logs WHERE run_id = ? AND created_at >= ? ORDER BY created_at ASC, rowid ASC")
      .all(runId, sinceCreatedAt) as StageLogRow[]
  }

  listLogsForWorkspace(workspaceId: string | null, sinceCreatedAt = 0): Array<StageLogRow & { item_id: string }> {
    if (workspaceId) {
      return this.db
        .prepare(
          `SELECT l.*, r.item_id
            FROM stage_logs l
             JOIN runs r ON r.id = l.run_id
            WHERE r.workspace_id = ? AND l.created_at >= ?
            ORDER BY l.created_at ASC, l.rowid ASC`
        )
        .all(workspaceId, sinceCreatedAt) as Array<StageLogRow & { item_id: string }>
    }
    return this.db
      .prepare(
        `SELECT l.*, r.item_id
           FROM stage_logs l
           JOIN runs r ON r.id = l.run_id
          WHERE l.created_at >= ?
          ORDER BY l.created_at ASC, l.rowid ASC`
      )
      .all(sinceCreatedAt) as Array<StageLogRow & { item_id: string }>
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

  createPendingPrompt(input: { id?: string; runId: string; stageRunId?: string | null; prompt: string }): PendingPromptRow {
    const row: PendingPromptRow = {
      id: input.id ?? randomUUID(),
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

  getPendingPrompt(id: string): PendingPromptRow | undefined {
    return this.db
      .prepare("SELECT * FROM pending_prompts WHERE id = ?")
      .get(id) as PendingPromptRow | undefined
  }

  claimNotificationDelivery(input: {
    dedupKey: string
    channel: string
    chatId: string
  }): boolean {
    // Re-claim rows that previously failed so a transient Telegram outage
    // doesn't permanently suppress the notification. Delivered rows remain
    // the dedupe fence.
    const timestamp = now()
    const result = this.db
      .prepare(
        `INSERT INTO notification_deliveries (
           dedup_key, channel, chat_id, status, attempt_count, last_attempt_at, delivered_at, error_message, created_at, updated_at
         ) VALUES (
           @dedup_key, @channel, @chat_id, 'pending', 0, NULL, NULL, NULL, @created_at, @updated_at
         )
         ON CONFLICT(dedup_key) DO UPDATE SET
           status = 'pending',
           updated_at = @updated_at
         WHERE notification_deliveries.status = 'failed'`
      )
      .run({
        dedup_key: input.dedupKey,
        channel: input.channel,
        chat_id: input.chatId,
        created_at: timestamp,
        updated_at: timestamp,
      })
    return result.changes > 0
  }

  completeNotificationDelivery(dedupKey: string, patch: {
    status: "delivered" | "failed"
    errorMessage?: string | null
  }): void {
    const timestamp = now()
    this.db
      .prepare(
        `UPDATE notification_deliveries
         SET status = ?,
             attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             delivered_at = ?,
             error_message = ?,
             updated_at = ?
         WHERE dedup_key = ?`
      )
      .run(
        patch.status,
        timestamp,
        patch.status === "delivered" ? timestamp : null,
        patch.errorMessage ?? null,
        timestamp,
        dedupKey,
      )
  }

  getNotificationDelivery(dedupKey: string): NotificationDeliveryRow | undefined {
    return this.db
      .prepare("SELECT * FROM notification_deliveries WHERE dedup_key = ?")
      .get(dedupKey) as NotificationDeliveryRow | undefined
  }

  listNotificationDeliveries(opts: {
    channel?: string
    limit?: number
  } = {}): NotificationDeliveryRow[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 20, 200))
    if (opts.channel) {
      return this.db
        .prepare(
          `SELECT * FROM notification_deliveries
           WHERE channel = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(opts.channel, limit) as NotificationDeliveryRow[]
    }
    return this.db
      .prepare(
        `SELECT * FROM notification_deliveries
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as NotificationDeliveryRow[]
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

  listOpenPrompts(opts: { workspaceId?: string } = {}): OpenPromptContextRow[] {
    if (opts.workspaceId) {
      return this.db
        .prepare(
          `SELECT p.*,
                  w.id AS workspace_id,
                  w.key AS workspace_key,
                  w.name AS workspace_name,
                  i.id AS item_id,
                  i.code AS item_code,
                  i.title AS item_title,
                  r.title AS run_title,
                  r.status AS run_status,
                  r.current_stage AS current_stage
             FROM pending_prompts p
             JOIN runs r ON r.id = p.run_id
             JOIN items i ON i.id = r.item_id
             JOIN workspaces w ON w.id = r.workspace_id
            WHERE p.answered_at IS NULL
              AND r.workspace_id = ?
            ORDER BY p.created_at ASC`
        )
        .all(opts.workspaceId) as OpenPromptContextRow[]
    }
    return this.db
      .prepare(
        `SELECT p.*,
                w.id AS workspace_id,
                w.key AS workspace_key,
                w.name AS workspace_name,
                i.id AS item_id,
                i.code AS item_code,
                i.title AS item_title,
                r.title AS run_title,
                r.status AS run_status,
                r.current_stage AS current_stage
           FROM pending_prompts p
           JOIN runs r ON r.id = p.run_id
           JOIN items i ON i.id = r.item_id
           JOIN workspaces w ON w.id = r.workspace_id
          WHERE p.answered_at IS NULL
          ORDER BY p.created_at ASC`
      )
      .all() as OpenPromptContextRow[]
  }
}

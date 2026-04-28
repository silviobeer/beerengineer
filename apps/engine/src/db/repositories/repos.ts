import { randomUUID } from "node:crypto"
import type { PromptAction } from "../../core/io.js"
import type { Db } from "../connection.js"
import type {
  ArtifactFileRow,
  ExternalRemediationRow,
  ItemRow,
  NotificationDeliveryRow,
  OpenPromptContextRow,
  PendingPromptRow,
  ProjectRow,
  RunOwner,
  RunRow,
  StageLogCursorRow,
  StageLogRow,
  StageRunRow,
  UpdateAttemptRow,
  WorkspaceRow,
} from "./types.js"

const now = () => Date.now()

type RowId = { id: string }
type LogScope = { runId: string } | { workspaceId: string | null }

export class Repos {
  private readonly latestTelegramDeliverySql = `SELECT * FROM notification_deliveries
       WHERE channel = 'telegram' AND chat_id = ?`

  constructor(private readonly db: Db) {}

  private run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...params)
  }

  private getOne<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  private getAll<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  private insertRow<T extends Record<string, unknown>>(table: string, row: T): T {
    const columns = Object.keys(row)
    const placeholders = columns.map((column) => `@${column}`)
    this.db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`).run(row)
    return row
  }

  private withTimestamps<T extends object>(row: T, timestamp = now()): T & { created_at: number; updated_at: number } {
    return { ...row, created_at: timestamp, updated_at: timestamp }
  }

  private clampLimit(limit: number | undefined, fallback = 20): number {
    return Math.max(1, Math.min(limit ?? fallback, 200))
  }

  private listLogsAfterId(scope: LogScope, afterId?: string | null, limit?: number): StageLogCursorRow[] {
    let afterRowId = 0
    if (afterId) {
      const runId = "runId" in scope ? scope.runId : undefined
      afterRowId = this.getStageLogCursorById(afterId, runId)?.log_rowid ?? 0
    }
    return this.listLogs(scope, {
      afterRowId,
      limit,
      includeCursor: true,
    })
  }

  private listLogs<T extends StageLogRow | StageLogCursorRow>(
    scope: LogScope,
    opts: { sinceCreatedAt?: number; afterRowId?: number; limit?: number; includeCursor?: boolean }
  ): T[] {
    const fromRun = "runId" in scope
    const alias = fromRun ? "" : "l."
    let select = "SELECT l.*, r.item_id"
    if (opts.includeCursor) {
      select = fromRun ? "SELECT rowid AS log_rowid, *" : "SELECT l.rowid AS log_rowid, l.*, r.item_id"
    } else if (fromRun) {
      select = "SELECT *"
    }
    const from = fromRun ? "FROM stage_logs" : "FROM stage_logs l JOIN runs r ON r.id = l.run_id"
    const where: string[] = []
    const params: unknown[] = []

    if (fromRun) {
      where.push("run_id = ?")
      params.push(scope.runId)
    } else if (scope.workspaceId) {
      where.push("r.workspace_id = ?")
      params.push(scope.workspaceId)
    }

    if (opts.sinceCreatedAt !== undefined) {
      where.push(`${alias}created_at >= ?`)
      params.push(opts.sinceCreatedAt)
    }
    if (opts.afterRowId !== undefined) {
      where.push(`${alias}rowid > ?`)
      params.push(opts.afterRowId)
    }

    const orderBy = opts.includeCursor ? `${alias}rowid ASC` : `${alias}created_at ASC, ${alias}rowid ASC`
    const limitSql = opts.limit === undefined ? "" : " LIMIT ?"
    if (opts.limit !== undefined) params.push(opts.limit)
    const whereClause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""
    const query = `${select} ${from}${whereClause} ORDER BY ${orderBy}${limitSql}`
    return this.getAll<T>(query, ...params)
  }

  getStageLogCursorById(id: string, runId?: string): { log_rowid: number } | undefined {
    return runId
      ? this.getOne("SELECT rowid AS log_rowid FROM stage_logs WHERE id = ? AND run_id = ?", id, runId)
      : this.getOne("SELECT rowid AS log_rowid FROM stage_logs WHERE id = ?", id)
  }

  private byId<T extends RowId>(table: string, id: string): T | undefined {
    return this.getOne<T>(`SELECT * FROM ${table} WHERE id = ?`, id)
  }

  upsertWorkspace(input: {
    key: string
    name: string
    description?: string | null
    rootPath?: string | null
    harnessProfileJson?: string
    sonarEnabled?: boolean
    lastOpenedAt?: number | null
  }): WorkspaceRow {
    const existing = this.getWorkspaceByKey(input.key)
    if (!existing) {
      const row: WorkspaceRow = this.withTimestamps({
        id: randomUUID(),
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        root_path: input.rootPath ?? null,
        harness_profile_json: input.harnessProfileJson ?? JSON.stringify({ mode: "claude-first" }),
        sonar_enabled: input.sonarEnabled ? 1 : 0,
        last_opened_at: input.lastOpenedAt ?? null,
      })
      return this.insertRow("workspaces", row)
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
      .run({
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        root_path: input.rootPath ?? existing.root_path,
        harness_profile_json: input.harnessProfileJson ?? existing.harness_profile_json,
        sonar_enabled: input.sonarEnabled === undefined ? existing.sonar_enabled : Number(input.sonarEnabled),
        last_opened_at: input.lastOpenedAt === undefined ? existing.last_opened_at : input.lastOpenedAt,
        updated_at: now(),
      })
    return this.getWorkspaceByKey(input.key) as WorkspaceRow
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.getAll("SELECT * FROM workspaces ORDER BY key ASC")
  }

  getWorkspace(id: string): WorkspaceRow | undefined {
    return this.byId("workspaces", id)
  }

  getWorkspaceByKey(key: string): WorkspaceRow | undefined {
    return this.getOne("SELECT * FROM workspaces WHERE key = ?", key)
  }

  getWorkspaceByRootPath(rootPath: string): WorkspaceRow | undefined {
    return this.getOne("SELECT * FROM workspaces WHERE root_path = ?", rootPath)
  }

  removeWorkspaceByKey(key: string): boolean {
    return this.db.prepare("DELETE FROM workspaces WHERE key = ?").run(key).changes > 0
  }

  touchWorkspaceLastOpenedAt(key: string, timestamp = now()): void {
    this.run("UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE key = ?", timestamp, timestamp, key)
  }

  /**
   * Mint the next monotonically increasing item code (`ITEM-####`) for a
   * workspace. Scans existing rows so the sequence survives process restarts
   * and shared DB access from CLI + API.
   */
  nextItemCode(workspaceId: string): string {
    const rows = this.getAll<{ code: string }>("SELECT code FROM items WHERE workspace_id = ? AND code LIKE 'ITEM-%'", workspaceId)
    let max = 0
    for (const { code } of rows) {
      const match = /^ITEM-(\d+)$/.exec(code)
      if (!match) continue
      const n = Number(match[1])
      if (Number.isFinite(n) && n > max) max = n
    }
    return `ITEM-${String(max + 1).padStart(4, "0")}`
  }

  getItem(id: string): ItemRow | undefined {
    return this.byId("items", id)
  }

  getItemByCode(workspaceId: string, code: string): ItemRow | undefined {
    return this.getOne("SELECT * FROM items WHERE workspace_id = ? AND code = ?", workspaceId, code)
  }

  findItemsByCode(code: string): ItemRow[] {
    return this.getAll("SELECT * FROM items WHERE code = ? ORDER BY created_at ASC", code)
  }

  listItemsForWorkspace(workspaceId: string): ItemRow[] {
    return this.getAll("SELECT * FROM items WHERE workspace_id = ? ORDER BY created_at ASC", workspaceId)
  }

  latestActiveRunForItem(itemId: string): RunRow | undefined {
    return this.getOne("SELECT * FROM runs WHERE item_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1", itemId)
  }

  latestRecoverableRunForItem(itemId: string): RunRow | undefined {
    return this.getOne(
      "SELECT * FROM runs WHERE item_id = ? AND recovery_status IS NOT NULL ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      itemId
    )
  }

  /**
   * Returns all runs for a given item ordered newest-first (by created_at).
   * Used by the DB-sync layer to determine whether a given run is still the
   * authoritative run for item state updates.
   */
  listRunsForItem(itemId: string): RunRow[] {
    return this.getAll("SELECT * FROM runs WHERE item_id = ? ORDER BY created_at DESC", itemId)
  }

  createItem(input: { workspaceId: string; code?: string; title: string; description: string }): ItemRow {
    const row: ItemRow = this.withTimestamps({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      code: input.code ?? this.nextItemCode(input.workspaceId),
      title: input.title,
      description: input.description,
      current_column: "idea",
      phase_status: "draft",
      current_stage: null,
    })
    return this.insertRow("items", row)
  }

  setItemColumn(itemId: string, column: ItemRow["current_column"], phaseStatus: ItemRow["phase_status"]): void {
    this.run("UPDATE items SET current_column = ?, phase_status = ?, updated_at = ? WHERE id = ?", column, phaseStatus, now(), itemId)
  }

  /**
   * Mirror the engine's stageKey for the *authoritative* run onto the item
   * row. `null` means the item has no live stage. Callers must gate this on
   * runOrchestrator's `isAuthoritative()` — never write from a side-run.
   */
  setItemCurrentStage(itemId: string, currentStage: string | null): void {
    this.run("UPDATE items SET current_stage = ?, updated_at = ? WHERE id = ?", currentStage, now(), itemId)
  }

  createProject(input: { id?: string; itemId: string; code: string; name: string; summary?: string; status?: string; position?: number }): ProjectRow {
    const existing = this.getOne<ProjectRow>("SELECT * FROM projects WHERE item_id = ? AND code = ?", input.itemId, input.code)
    if (existing) return existing

    const existingById = input.id ? this.byId<ProjectRow>("projects", input.id) : undefined
    const row: ProjectRow = this.withTimestamps({
      id: existingById && existingById.item_id !== input.itemId ? randomUUID() : input.id ?? randomUUID(),
      item_id: input.itemId,
      code: input.code,
      name: input.name,
      summary: input.summary ?? "",
      status: input.status ?? "draft",
      position: input.position ?? 0,
    })
    return this.insertRow("projects", row)
  }

  createRun(input: { workspaceId: string; itemId: string; title: string; owner?: RunOwner; workspaceFsId?: string | null }): RunRow {
    const row: RunRow = this.withTimestamps({
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
    })
    return this.insertRow("runs", row)
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRow, "status" | "current_stage" | "recovery_status" | "recovery_scope" | "recovery_scope_ref" | "recovery_summary">>
  ): void {
    const existing = this.getRun(id)
    if (!existing) return
    const next = { ...existing, ...patch, updated_at: now() }
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?, current_stage = ?, recovery_status = ?, recovery_scope = ?, recovery_scope_ref = ?, recovery_summary = ?, updated_at = ?
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
        id
      )
  }

  /**
   * Write the recovery projection onto a run. Pass `null` for all fields to
   * clear (used when a blocked scope resumes successfully).
   */
  setRunRecovery(
    id: string,
    patch: { status: RunRow["recovery_status"]; scope: RunRow["recovery_scope"]; scopeRef: string | null; summary: string | null }
  ): void {
    this.run(
      `UPDATE runs
       SET recovery_status = ?, recovery_scope = ?, recovery_scope_ref = ?, recovery_summary = ?, updated_at = ?
       WHERE id = ?`,
      patch.status,
      patch.scope,
      patch.scopeRef,
      patch.summary,
      now(),
      id
    )
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
      created_at: now(),
    }
    return this.insertRow("external_remediations", row)
  }

  latestExternalRemediation(runId: string): ExternalRemediationRow | undefined {
    return this.getOne("SELECT * FROM external_remediations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", runId)
  }

  listExternalRemediations(runId: string): ExternalRemediationRow[] {
    return this.getAll("SELECT * FROM external_remediations WHERE run_id = ? ORDER BY created_at ASC", runId)
  }

  getRun(id: string): RunRow | undefined {
    return this.byId("runs", id)
  }

  listRuns(): RunRow[] {
    return this.getAll("SELECT * FROM runs ORDER BY created_at DESC")
  }

  /**
   * Return every run currently in `status='running'`. Used at startup to
   * identify orphaned runs (workers that died with the previous process).
   */
  listRunningRuns(): RunRow[] {
    return this.getAll("SELECT * FROM runs WHERE status = 'running' ORDER BY created_at ASC")
  }

  createStageRun(input: { id?: string; runId: string; stageKey: string; projectId?: string | null }): StageRunRow {
    const timestamp = now()
    const row: StageRunRow = this.withTimestamps({
      id: input.id ?? randomUUID(),
      run_id: input.runId,
      project_id: input.projectId ?? null,
      stage_key: input.stageKey,
      status: "running",
      stage_agent_session_id: null,
      reviewer_session_id: null,
      started_at: timestamp,
      completed_at: null,
      error_message: null,
    }, timestamp)
    return this.insertRow("stage_runs", row)
  }

  updateStageRunSessions(id: string, sessions: { stageAgentSessionId?: string | null; reviewerSessionId?: string | null }): void {
    this.db
      .prepare(
        "UPDATE stage_runs SET stage_agent_session_id = COALESCE(?, stage_agent_session_id), reviewer_session_id = COALESCE(?, reviewer_session_id), updated_at = ? WHERE id = ?"
      )
      .run(sessions.stageAgentSessionId, sessions.reviewerSessionId, now(), id)
  }

  completeStageRun(id: string, status: "completed" | "failed", errorMessage?: string | null): void {
    const timestamp = now()
    this.run("UPDATE stage_runs SET status = ?, completed_at = ?, error_message = ?, updated_at = ? WHERE id = ?", status, timestamp, errorMessage ?? null, timestamp, id)
  }

  listStageRunsForRun(runId: string): StageRunRow[] {
    return this.getAll("SELECT * FROM stage_runs WHERE run_id = ? ORDER BY created_at ASC", runId)
  }

  appendLog(input: { runId: string; stageRunId?: string | null; eventType: string; message?: string; data?: unknown }): StageLogRow {
    const row: StageLogRow = {
      id: randomUUID(),
      run_id: input.runId,
      stage_run_id: input.stageRunId ?? null,
      event_type: input.eventType,
      message: input.message ?? "",
      data_json: input.data === undefined ? null : JSON.stringify(input.data),
      created_at: now(),
    }
    this.insertRow("stage_logs", row)

    const touchedAt = now()
    this.run("UPDATE runs SET updated_at = ? WHERE id = ?", touchedAt, input.runId)
    if (input.stageRunId) {
      this.run("UPDATE stage_runs SET updated_at = ? WHERE id = ?", touchedAt, input.stageRunId)
    }
    return row
  }

  listLogsForRun(runId: string, sinceCreatedAt = 0): StageLogRow[] {
    return this.listLogs({ runId }, { sinceCreatedAt })
  }

  listLogsForRunAfterCursor(runId: string, afterRowId = 0, limit?: number): StageLogCursorRow[] {
    return this.listLogs({ runId }, { afterRowId, limit, includeCursor: true })
  }

  listLogsForRunAfterId(runId: string, afterId?: string | null, limit?: number): StageLogCursorRow[] {
    return this.listLogsAfterId({ runId }, afterId, limit)
  }

  listLogsForWorkspace(workspaceId: string | null, sinceCreatedAt = 0): Array<StageLogRow & { item_id: string }> {
    return this.listLogs({ workspaceId }, { sinceCreatedAt })
  }

  listLogsForWorkspaceAfterCursor(workspaceId: string | null, afterRowId = 0, limit?: number): StageLogCursorRow[] {
    return this.listLogs({ workspaceId }, { afterRowId, limit, includeCursor: true })
  }

  listLogsForWorkspaceAfterId(workspaceId: string | null, afterId?: string | null, limit?: number): StageLogCursorRow[] {
    return this.listLogsAfterId({ workspaceId }, afterId, limit)
  }

  recordArtifact(input: { runId?: string | null; stageRunId?: string | null; projectId?: string | null; label: string; kind: string; path: string }): ArtifactFileRow {
    const row: ArtifactFileRow = {
      id: randomUUID(),
      run_id: input.runId ?? null,
      stage_run_id: input.stageRunId ?? null,
      project_id: input.projectId ?? null,
      label: input.label,
      kind: input.kind,
      path: input.path,
      created_at: now(),
    }
    return this.insertRow("artifact_files", row)
  }

  listArtifactsForRun(runId: string): ArtifactFileRow[] {
    return this.getAll("SELECT * FROM artifact_files WHERE run_id = ? ORDER BY created_at ASC", runId)
  }

  createPendingPrompt(input: { id?: string; runId: string; stageRunId?: string | null; prompt: string; actions?: PromptAction[] }): PendingPromptRow {
    const row: PendingPromptRow = {
      id: input.id ?? randomUUID(),
      run_id: input.runId,
      stage_run_id: input.stageRunId ?? null,
      prompt: input.prompt,
      actions_json: input.actions?.length ? JSON.stringify(input.actions) : null,
      answer: null,
      created_at: now(),
      answered_at: null,
    }
    return this.insertRow("pending_prompts", row)
  }

  getPendingPrompt(id: string): PendingPromptRow | undefined {
    return this.byId("pending_prompts", id)
  }

  /**
   * Try to claim a dedup slot for an outbound notification. Returns `true`
   * when the caller owns the delivery and must attempt the send. Three cases
   * where a claim succeeds even though a row already exists:
   *   - the previous attempt ended in `failed` (transient Telegram outage
   *     shouldn't permanently suppress the notification);
   *   - the previous row was `delivered` but its `expires_at` has passed
   *     (used by the `prompt_requested` rate-limit guard: subsequent prompts
   *     re-notify after N seconds).
   * Callers that carry an openPrompt set `runId` / `promptId` so the inbound
   * Telegram webhook can later resolve a reply_to_message_id back to the
   * originating run + prompt.
   */
  claimNotificationDelivery(input: {
    dedupKey: string
    channel: string
    chatId: string
    runId?: string | null
    promptId?: string | null
    expiresAt?: number | null
  }): boolean {
    const timestamp = now()
    return this.db
      .prepare(
        `INSERT INTO notification_deliveries (
           dedup_key, channel, chat_id, status, attempt_count, last_attempt_at, delivered_at, error_message,
           run_id, prompt_id, telegram_message_id, expires_at, created_at, updated_at
         ) VALUES (
           @dedup_key, @channel, @chat_id, 'pending', 0, NULL, NULL, NULL,
           @run_id, @prompt_id, NULL, @expires_at, @created_at, @updated_at
         )
         ON CONFLICT(dedup_key) DO UPDATE SET
           status = 'pending',
           run_id = COALESCE(excluded.run_id, notification_deliveries.run_id),
           prompt_id = COALESCE(excluded.prompt_id, notification_deliveries.prompt_id),
           expires_at = excluded.expires_at,
           updated_at = @updated_at
         WHERE notification_deliveries.status = 'failed'
            OR (
              notification_deliveries.expires_at IS NOT NULL
              AND notification_deliveries.expires_at <= @updated_at
            )`
      )
      .run({
        dedup_key: input.dedupKey,
        channel: input.channel,
        chat_id: input.chatId,
        run_id: input.runId ?? null,
        prompt_id: input.promptId ?? null,
        expires_at: input.expiresAt ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      }).changes > 0
  }

  completeNotificationDelivery(
    dedupKey: string,
    patch: { status: "delivered" | "failed"; errorMessage?: string | null; telegramMessageId?: number | null }
  ): void {
    const timestamp = now()
    this.db
      .prepare(
        `UPDATE notification_deliveries
         SET status = ?, attempt_count = attempt_count + 1, last_attempt_at = ?, delivered_at = ?, error_message = ?,
             telegram_message_id = COALESCE(?, telegram_message_id), updated_at = ?
         WHERE dedup_key = ?`
      )
      .run(
        patch.status,
        timestamp,
        patch.status === "delivered" ? timestamp : null,
        patch.errorMessage ?? null,
        patch.telegramMessageId ?? null,
        timestamp,
        dedupKey
      )
  }

  /**
   * Resolve a Telegram reply to the originating (runId, promptId). Returns
   * the most recent delivery that targeted the given chat with the given
   * message_id — the inbound webhook uses this to route an answer without a
   * separate channel-binding table.
   */
  findTelegramDeliveryByMessage(input: { chatId: string; messageId: number }): NotificationDeliveryRow | undefined {
    return this.getOne(
      `${this.latestTelegramDeliverySql} AND telegram_message_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      input.chatId,
      input.messageId
    )
  }

  /**
   * Most-recent telegram delivery for a chat that carries an open-prompt
   * pointer. Used as a fallback when the operator sends a bare message (no
   * reply-to) on a single-chat deployment.
   */
  findLatestTelegramPromptDeliveryForChat(chatId: string): NotificationDeliveryRow | undefined {
    return this.getOne(
      `${this.latestTelegramDeliverySql} AND prompt_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      chatId
    )
  }

  getNotificationDelivery(dedupKey: string): NotificationDeliveryRow | undefined {
    return this.getOne("SELECT * FROM notification_deliveries WHERE dedup_key = ?", dedupKey)
  }

  listNotificationDeliveries(opts: { channel?: string; limit?: number } = {}): NotificationDeliveryRow[] {
    const limit = this.clampLimit(opts.limit)
    return opts.channel
      ? this.getAll(
          `SELECT * FROM notification_deliveries
           WHERE channel = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          opts.channel,
          limit
        )
      : this.getAll(
          `SELECT * FROM notification_deliveries
           ORDER BY created_at DESC
           LIMIT ?`,
          limit
        )
  }

  upsertUpdateAttempt(input: {
    operationId: string
    idempotencyKey?: string | null
    kind: string
    status: string
    fromVersion?: string | null
    targetVersion?: string | null
    dbPath?: string | null
    dbPathSource?: string | null
    legacyDbShadow?: boolean
    installRoot?: string | null
    backupDir?: string | null
    errorMessage?: string | null
    metadataJson?: string | null
    completedAt?: number | null
  }): UpdateAttemptRow {
    const existing = this.getUpdateAttempt(input.operationId)
    const timestamp = now()
    const row: UpdateAttemptRow = {
      operation_id: input.operationId,
      idempotency_key: input.idempotencyKey ?? existing?.idempotency_key ?? null,
      kind: input.kind,
      status: input.status,
      from_version: input.fromVersion ?? existing?.from_version ?? null,
      target_version: input.targetVersion ?? existing?.target_version ?? null,
      db_path: input.dbPath ?? existing?.db_path ?? null,
      db_path_source: input.dbPathSource ?? existing?.db_path_source ?? null,
      legacy_db_shadow: input.legacyDbShadow === undefined ? existing?.legacy_db_shadow ?? 0 : Number(input.legacyDbShadow),
      install_root: input.installRoot ?? existing?.install_root ?? null,
      backup_dir: input.backupDir ?? existing?.backup_dir ?? null,
      error_message: input.errorMessage ?? existing?.error_message ?? null,
      metadata_json: input.metadataJson ?? existing?.metadata_json ?? null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
      completed_at: input.completedAt === undefined ? existing?.completed_at ?? null : input.completedAt,
    }
    this.db
      .prepare(
        `INSERT INTO update_attempts (
           operation_id, idempotency_key, kind, status, from_version, target_version,
           db_path, db_path_source, legacy_db_shadow, install_root, backup_dir,
           error_message, metadata_json, created_at, updated_at, completed_at
         ) VALUES (
           @operation_id, @idempotency_key, @kind, @status, @from_version, @target_version,
           @db_path, @db_path_source, @legacy_db_shadow, @install_root, @backup_dir,
           @error_message, @metadata_json, @created_at, @updated_at, @completed_at
         )
         ON CONFLICT(operation_id) DO UPDATE SET
           idempotency_key = excluded.idempotency_key,
           kind = excluded.kind,
           status = excluded.status,
           from_version = excluded.from_version,
           target_version = excluded.target_version,
           db_path = excluded.db_path,
           db_path_source = excluded.db_path_source,
           legacy_db_shadow = excluded.legacy_db_shadow,
           install_root = excluded.install_root,
           backup_dir = excluded.backup_dir,
           error_message = excluded.error_message,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at`
      )
      .run(row)
    return this.getUpdateAttempt(input.operationId)!
  }

  getUpdateAttempt(operationId: string): UpdateAttemptRow | undefined {
    return this.getOne("SELECT * FROM update_attempts WHERE operation_id = ?", operationId)
  }

  getUpdateAttemptByIdempotencyKey(idempotencyKey: string): UpdateAttemptRow | undefined {
    return this.getOne("SELECT * FROM update_attempts WHERE idempotency_key = ?", idempotencyKey)
  }

  listUpdateAttempts(limit = 20): UpdateAttemptRow[] {
    return this.getAll(
      `SELECT * FROM update_attempts
       ORDER BY created_at DESC
       LIMIT ?`,
      this.clampLimit(limit, 20)
    )
  }

  answerPendingPrompt(id: string, answer: string): PendingPromptRow | undefined {
    this.run("UPDATE pending_prompts SET answer = ?, answered_at = ? WHERE id = ? AND answered_at IS NULL", answer, now(), id)
    return this.getPendingPrompt(id)
  }

  getOpenPrompt(runId: string): PendingPromptRow | undefined {
    return this.getOne(
      "SELECT * FROM pending_prompts WHERE run_id = ? AND answered_at IS NULL ORDER BY created_at DESC LIMIT 1",
      runId
    )
  }

  listOpenPrompts(opts: { workspaceId?: string } = {}): OpenPromptContextRow[] {
    const sql = `SELECT p.*,
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
                  WHERE p.answered_at IS NULL`
    return opts.workspaceId
      ? this.getAll(`${sql} AND r.workspace_id = ? ORDER BY p.created_at ASC`, opts.workspaceId)
      : this.getAll(`${sql} ORDER BY p.created_at ASC`)
  }
}

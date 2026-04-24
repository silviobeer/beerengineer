-- beerengineer2 board + engine schema.
-- Compatible with the queries in apps/ui/lib/live-board.ts (workspaces, items, projects)
-- and extended with engine-side tables (runs, stage_runs, stage_logs, artifact_files).

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  root_path TEXT,
  harness_profile_json TEXT NOT NULL DEFAULT '{"mode":"claude-first"}',
  sonar_enabled INTEGER NOT NULL DEFAULT 0,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The UI groups cards by items.current_column. Values must stay in sync with
-- orderedBoardColumns in apps/ui/lib/live-board.ts:
--   idea | brainstorm | requirements | implementation | done
-- phase_status values consumed by the UI:
--   draft | running | review_required | completed | failed
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  current_column TEXT NOT NULL DEFAULT 'idea',
  phase_status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, code)
);

-- projects belong to an item; live-board.ts only needs id + item_id for counts.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(item_id, code)
);

-- A workflow run orchestrated by the engine. One run is for one item.
-- owner records which surface started the run: "api" (HTTP) or "cli" (terminal).
-- recovery_* columns are a projection of the canonical `recovery.json` file on
-- disk. The filesystem record is authoritative; these columns power list/board
-- queries without touching the filesystem. `recovery_scope_ref` holds the
-- stageId for stage scope or "<wave>/<story>" for story scope.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_stage TEXT,
  owner TEXT NOT NULL DEFAULT 'api',
  recovery_status TEXT,
  recovery_scope TEXT,
  recovery_scope_ref TEXT,
  recovery_summary TEXT,
  workspace_fs_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Operator-recorded audit trail of external remediations. One row per resume
-- request. The most recent row for a run is injected into the next
-- implementation + review prompt (see ralphRuntime.ts).
CREATE TABLE IF NOT EXISTS external_remediations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  scope TEXT NOT NULL,
  scope_ref TEXT,
  summary TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  review_notes TEXT,
  source TEXT NOT NULL,
  actor_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS external_remediations_run_idx ON external_remediations(run_id, created_at);

-- stage_runs records each stage invocation (brainstorm, requirements, ...).
CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  project_id TEXT REFERENCES projects(id),
  stage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stage_agent_session_id TEXT,
  reviewer_session_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Append-only event + log feed for a run. Powers the timeline & SSE.
CREATE TABLE IF NOT EXISTS stage_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage_run_id TEXT REFERENCES stage_runs(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  data_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stage_logs_run_created_idx ON stage_logs(run_id, created_at);

-- Pointer records for artifacts written to disk.
CREATE TABLE IF NOT EXISTS artifact_files (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  stage_run_id TEXT REFERENCES stage_runs(id),
  project_id TEXT REFERENCES projects(id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Pending human prompts. The engine inserts rows when awaiting input;
-- the UI answers via POST /runs/:id/answer which updates answered_at + answer.
CREATE TABLE IF NOT EXISTS pending_prompts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage_run_id TEXT REFERENCES stage_runs(id),
  prompt TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS pending_prompts_run_idx ON pending_prompts(run_id, answered_at);

-- Durable dedup + audit for outbound notifications. One row per unique
-- delivery intent; replaying the same dedup_key is a no-op.
-- `run_id` / `prompt_id` / `telegram_message_id` are set for messages that
-- carry an openPrompt so the inbound Telegram webhook can map a reply back
-- to the originating (runId, promptId) via the Telegram message_id.
-- `expires_at` lets rate-limit-style dedups age out without deleting rows.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  dedup_key TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  delivered_at INTEGER,
  error_message TEXT,
  run_id TEXT,
  prompt_id TEXT,
  telegram_message_id INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_deliveries_channel_created_idx
  ON notification_deliveries(channel, created_at);
-- The `telegram_message_id` / `run_id` / `prompt_id` indexes are created by
-- migrateNotificationDeliveriesTable() after the ALTER TABLE ADD COLUMN runs
-- for pre-existing DBs. Keeping them there (not here) lets the migration run
-- in the right order: columns first, then indexes that depend on them.

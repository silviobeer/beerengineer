export type WorkspaceRow = {
  id: string
  key: string
  name: string
  description: string | null
  root_path: string | null
  harness_profile_json: string
  sonar_enabled: number
  supabase_project_ref: string | null
  supabase_region: string | null
  supabase_persistent_test_branch_ref: string | null
  supabase_persistent_test_branch_name: string | null
  supabase_persistent_test_branch_status: string | null
  supabase_last_checked_at: number | null
  supabase_cleanup_policy: "on-success-immediate" | "ttl-after-success" | "manual"
  supabase_cleanup_ttl_hours: number | null
  supabase_branch_quota_usage: number | null
  supabase_branch_quota_limit: number | null
  supabase_protection_switch: "off" | "on"
  supabase_settings_version: number
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
  current_column: "idea" | "brainstorm" | "frontend" | "requirements" | "implementation" | "merge" | "done"
  phase_status: "draft" | "running" | "review_required" | "completed" | "failed"
  current_stage: string | null
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
export type WorkerOwnerKind = "cli" | "api"

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
  worker_instance_id: string | null
  worker_owner_kind: WorkerOwnerKind | null
  worker_started_at: number | null
  worker_heartbeat_at: number | null
  workspace_fs_id: string | null
  supabase_branch_ref: string | null
  supabase_branch_name: string | null
  supabase_branch_lifecycle_state: string | null
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

export type StageLogCursorRow = StageLogRow & {
  log_rowid: number
  item_id?: string
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
  actions_json: string | null
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
  run_id: string | null
  prompt_id: string | null
  telegram_message_id: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

export type UpdateAttemptRow = {
  operation_id: string
  idempotency_key: string | null
  kind: string
  status: string
  from_version: string | null
  target_version: string | null
  db_path: string | null
  db_path_source: string | null
  legacy_db_shadow: number
  install_root: string | null
  backup_dir: string | null
  error_message: string | null
  metadata_json: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

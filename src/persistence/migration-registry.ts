export type SqlMigration = {
  readonly id: string;
  readonly statements: readonly string[];
};

import { DEFAULT_WORKSPACE_ID } from "../shared/workspaces.js";

const defaultWorkspaceId = DEFAULT_WORKSPACE_ID;
const migrationTimestamp = 0;

export const baseMigrations: readonly SqlMigration[] = [
  {
    id: "0000_initial",
    statements: [
      `CREATE TABLE IF NOT EXISTS __migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `PRAGMA foreign_keys = ON`,
      `CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS workspace_settings (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        default_adapter_key TEXT,
        default_model TEXT,
        autorun_policy_json TEXT,
        prompt_overrides_json TEXT,
        skill_overrides_json TEXT,
        verification_defaults_json TEXT,
        qa_defaults_json TEXT,
        git_defaults_json TEXT,
        execution_defaults_json TEXT,
        ui_metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `INSERT OR IGNORE INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
        VALUES ('${defaultWorkspaceId}', 'default', 'Default Workspace', NULL, NULL, ${migrationTimestamp}, ${migrationTimestamp})`,
      `INSERT OR IGNORE INTO workspace_settings (
        workspace_id,
        default_adapter_key,
        default_model,
        autorun_policy_json,
        prompt_overrides_json,
        skill_overrides_json,
        verification_defaults_json,
        qa_defaults_json,
        git_defaults_json,
        execution_defaults_json,
        ui_metadata_json,
        created_at,
        updated_at
      ) VALUES (
        '${defaultWorkspaceId}',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        ${migrationTimestamp},
        ${migrationTimestamp}
      )`,
      `CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        current_column TEXT NOT NULL,
        phase_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_items_workspace_code_unique ON items(workspace_id, code)`,
      `CREATE TABLE IF NOT EXISTS stage_runs (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        project_id TEXT,
        stage_key TEXT NOT NULL,
        status TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        system_prompt_snapshot TEXT NOT NULL,
        skills_snapshot_json TEXT NOT NULL,
        output_summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )`,
      `CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        markdown_artifact_id TEXT NOT NULL,
        structured_artifact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )`,
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        concept_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (concept_id) REFERENCES concepts(id)
      )`,
      `CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        stage_run_id TEXT,
        item_id TEXT NOT NULL,
        project_id TEXT,
        kind TEXT NOT NULL,
        format TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (stage_run_id) REFERENCES stage_runs(id),
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS user_stories (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        actor TEXT NOT NULL,
        goal TEXT NOT NULL,
        benefit TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        source_artifact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (source_artifact_id) REFERENCES artifacts(id)
      )`,
      `CREATE TABLE IF NOT EXISTS acceptance_criteria (
        id TEXT PRIMARY KEY NOT NULL,
        story_id TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_plans (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        markdown_artifact_id TEXT NOT NULL,
        structured_artifact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (markdown_artifact_id) REFERENCES artifacts(id),
        FOREIGN KEY (structured_artifact_id) REFERENCES artifacts(id)
      )`,
      `CREATE TABLE IF NOT EXISTS implementation_plans (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        markdown_artifact_id TEXT NOT NULL,
        structured_artifact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (markdown_artifact_id) REFERENCES artifacts(id),
        FOREIGN KEY (structured_artifact_id) REFERENCES artifacts(id)
      )`,
      `CREATE TABLE IF NOT EXISTS waves (
        id TEXT PRIMARY KEY NOT NULL,
        implementation_plan_id TEXT NOT NULL,
        code TEXT NOT NULL,
        goal TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (implementation_plan_id) REFERENCES implementation_plans(id)
      )`,
      `CREATE TABLE IF NOT EXISTS wave_stories (
        id TEXT PRIMARY KEY NOT NULL,
        wave_id TEXT NOT NULL,
        story_id TEXT NOT NULL UNIQUE,
        parallel_group TEXT,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (wave_id) REFERENCES waves(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS wave_story_dependencies (
        blocking_story_id TEXT NOT NULL,
        dependent_story_id TEXT NOT NULL,
        PRIMARY KEY (blocking_story_id, dependent_story_id),
        FOREIGN KEY (blocking_story_id) REFERENCES user_stories(id),
        FOREIGN KEY (dependent_story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS project_execution_contexts (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL UNIQUE,
        relevant_directories_json TEXT NOT NULL,
        relevant_files_json TEXT NOT NULL,
        integration_points_json TEXT NOT NULL,
        test_locations_json TEXT NOT NULL,
        repo_conventions_json TEXT NOT NULL,
        execution_notes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS wave_executions (
        id TEXT PRIMARY KEY NOT NULL,
        wave_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (wave_id) REFERENCES waves(id)
      )`,
      `CREATE TABLE IF NOT EXISTS wave_story_test_runs (
        id TEXT PRIMARY KEY NOT NULL,
        wave_execution_id TEXT NOT NULL,
        wave_story_id TEXT NOT NULL,
        story_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        worker_role TEXT NOT NULL,
        business_context_snapshot_json TEXT NOT NULL,
        repo_context_snapshot_json TEXT NOT NULL,
        output_summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (wave_execution_id) REFERENCES wave_executions(id),
        FOREIGN KEY (wave_story_id) REFERENCES wave_stories(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS wave_story_executions (
        id TEXT PRIMARY KEY NOT NULL,
        wave_execution_id TEXT NOT NULL,
        test_preparation_run_id TEXT NOT NULL,
        wave_story_id TEXT NOT NULL,
        story_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        worker_role TEXT NOT NULL,
        business_context_snapshot_json TEXT NOT NULL,
        repo_context_snapshot_json TEXT NOT NULL,
        output_summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (wave_execution_id) REFERENCES wave_executions(id),
        FOREIGN KEY (test_preparation_run_id) REFERENCES wave_story_test_runs(id),
        FOREIGN KEY (wave_story_id) REFERENCES wave_stories(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS test_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        wave_story_test_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (wave_story_test_run_id) REFERENCES wave_story_test_runs(id)
      )`,
      `CREATE TABLE IF NOT EXISTS execution_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        wave_story_execution_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS verification_runs (
        id TEXT PRIMARY KEY NOT NULL,
        wave_execution_id TEXT,
        wave_story_execution_id TEXT,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (wave_execution_id) REFERENCES wave_executions(id),
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        stage_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (stage_run_id) REFERENCES stage_runs(id)
      )`,
      `CREATE TABLE IF NOT EXISTS stage_run_input_artifacts (
        stage_run_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        PRIMARY KEY (stage_run_id, artifact_id),
        FOREIGN KEY (stage_run_id) REFERENCES stage_runs(id),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
      )`,
      `CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ]
  }
  ,
  {
    id: "0001_add_verification_run_mode",
    statements: [
      `ALTER TABLE verification_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'basic'`
    ]
  },
  {
    id: "0002_add_qa_runtime_tables",
    statements: [
      `CREATE TABLE IF NOT EXISTS qa_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS qa_findings (
        id TEXT PRIMARY KEY NOT NULL,
        qa_run_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence TEXT NOT NULL,
        repro_steps_json TEXT NOT NULL,
        suggested_fix TEXT,
        status TEXT NOT NULL,
        story_id TEXT,
        acceptance_criterion_id TEXT,
        wave_story_execution_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (qa_run_id) REFERENCES qa_runs(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id),
        FOREIGN KEY (acceptance_criterion_id) REFERENCES acceptance_criteria(id),
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS qa_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        qa_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (qa_run_id) REFERENCES qa_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_qa_runs_project_id ON qa_runs(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_qa_findings_qa_run_id ON qa_findings(qa_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_qa_agent_sessions_qa_run_id ON qa_agent_sessions(qa_run_id)`
    ]
  },
  {
    id: "0003_add_story_review_runtime_tables",
    statements: [
      `CREATE TABLE IF NOT EXISTS story_review_runs (
        id TEXT PRIMARY KEY NOT NULL,
        wave_story_execution_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS story_review_findings (
        id TEXT PRIMARY KEY NOT NULL,
        story_review_run_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence TEXT NOT NULL,
        file_path TEXT,
        line INTEGER,
        suggested_fix TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (story_review_run_id) REFERENCES story_review_runs(id)
      )`,
      `CREATE TABLE IF NOT EXISTS story_review_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        story_review_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (story_review_run_id) REFERENCES story_review_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_runs_wave_story_execution_id ON story_review_runs(wave_story_execution_id)`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_findings_story_review_run_id ON story_review_findings(story_review_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_agent_sessions_story_review_run_id ON story_review_agent_sessions(story_review_run_id)`
    ]
  },
  {
    id: "0004_add_worker_prompt_skill_snapshots",
    statements: [
      `ALTER TABLE wave_story_test_runs ADD COLUMN system_prompt_snapshot TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE wave_story_test_runs ADD COLUMN skills_snapshot_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE wave_story_executions ADD COLUMN system_prompt_snapshot TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE wave_story_executions ADD COLUMN skills_snapshot_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE verification_runs ADD COLUMN system_prompt_snapshot TEXT`,
      `ALTER TABLE verification_runs ADD COLUMN skills_snapshot_json TEXT`,
      `ALTER TABLE story_review_runs ADD COLUMN system_prompt_snapshot TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE story_review_runs ADD COLUMN skills_snapshot_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE qa_runs ADD COLUMN system_prompt_snapshot TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE qa_runs ADD COLUMN skills_snapshot_json TEXT NOT NULL DEFAULT '[]'`
    ]
  },
  {
    id: "0005_add_documentation_runtime_tables",
    statements: [
      `CREATE TABLE IF NOT EXISTS documentation_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        system_prompt_snapshot TEXT NOT NULL,
        skills_snapshot_json TEXT NOT NULL,
        summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS documentation_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        documentation_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (documentation_run_id) REFERENCES documentation_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_documentation_runs_project_id ON documentation_runs(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_documentation_agent_sessions_documentation_run_id ON documentation_agent_sessions(documentation_run_id)`
    ]
  },
  {
    id: "0006_add_remediation_and_git_runtime_tables",
    statements: [
      `ALTER TABLE wave_story_executions ADD COLUMN git_branch_name TEXT`,
      `ALTER TABLE wave_story_executions ADD COLUMN git_base_ref TEXT`,
      `ALTER TABLE wave_story_executions ADD COLUMN git_metadata_json TEXT`,
      `ALTER TABLE documentation_runs ADD COLUMN stale_at INTEGER`,
      `ALTER TABLE documentation_runs ADD COLUMN stale_reason TEXT`,
      `CREATE TABLE IF NOT EXISTS story_review_remediation_runs (
        id TEXT PRIMARY KEY NOT NULL,
        story_review_run_id TEXT NOT NULL,
        wave_story_execution_id TEXT NOT NULL,
        remediation_wave_story_execution_id TEXT,
        story_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        worker_role TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        system_prompt_snapshot TEXT NOT NULL,
        skills_snapshot_json TEXT NOT NULL,
        git_branch_name TEXT,
        git_base_ref TEXT,
        git_metadata_json TEXT,
        output_summary_json TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (story_review_run_id) REFERENCES story_review_runs(id),
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id),
        FOREIGN KEY (remediation_wave_story_execution_id) REFERENCES wave_story_executions(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE TABLE IF NOT EXISTS story_review_remediation_findings (
        story_review_remediation_run_id TEXT NOT NULL,
        story_review_finding_id TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (story_review_remediation_run_id, story_review_finding_id),
        FOREIGN KEY (story_review_remediation_run_id) REFERENCES story_review_remediation_runs(id),
        FOREIGN KEY (story_review_finding_id) REFERENCES story_review_findings(id)
      )`,
      `CREATE TABLE IF NOT EXISTS story_review_remediation_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        story_review_remediation_run_id TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        status TEXT NOT NULL,
        command_json TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (story_review_remediation_run_id) REFERENCES story_review_remediation_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_remediation_runs_story_id ON story_review_remediation_runs(story_id)`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_remediation_runs_story_review_run_id ON story_review_remediation_runs(story_review_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_remediation_findings_run_id ON story_review_remediation_findings(story_review_remediation_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_story_review_remediation_agent_sessions_run_id ON story_review_remediation_agent_sessions(story_review_remediation_run_id)`
    ]
  },
  {
    id: "0007_add_workspaces",
    // New installs already get these tables from 0000_initial. This migration
    // records the workspace rollout for pre-workspace databases, while the
    // migrator compatibility pass handles older edge cases such as legacy item
    // schema repair on startup.
    statements: [
      `CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS workspace_settings (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        default_adapter_key TEXT,
        default_model TEXT,
        autorun_policy_json TEXT,
        prompt_overrides_json TEXT,
        skill_overrides_json TEXT,
        verification_defaults_json TEXT,
        qa_defaults_json TEXT,
        git_defaults_json TEXT,
        execution_defaults_json TEXT,
        ui_metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `INSERT OR IGNORE INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
        VALUES ('${defaultWorkspaceId}', 'default', 'Default Workspace', NULL, NULL, ${migrationTimestamp}, ${migrationTimestamp})`,
      `INSERT OR IGNORE INTO workspace_settings (
        workspace_id,
        default_adapter_key,
        default_model,
        autorun_policy_json,
        prompt_overrides_json,
        skill_overrides_json,
        verification_defaults_json,
        qa_defaults_json,
        git_defaults_json,
        execution_defaults_json,
        ui_metadata_json,
        created_at,
        updated_at
      ) VALUES (
        '${defaultWorkspaceId}',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        ${migrationTimestamp},
        ${migrationTimestamp}
      )`
    ]
  },
  {
    id: "0008_interactive_review",
    statements: [
      `CREATE TABLE IF NOT EXISTS interactive_review_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        review_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        last_assistant_message_id TEXT,
        last_user_message_id TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS interactive_review_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        structured_payload_json TEXT,
        derived_updates_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES interactive_review_sessions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS interactive_review_entries (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        change_request TEXT,
        rationale TEXT,
        severity TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES interactive_review_sessions(id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS interactive_review_entry_unique_idx
        ON interactive_review_entries(session_id, entry_type, entry_id)`,
      `CREATE TABLE IF NOT EXISTS interactive_review_resolutions (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        resolution_type TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        applied_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES interactive_review_sessions(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_interactive_review_sessions_scope
        ON interactive_review_sessions(scope_type, scope_id, artifact_type, review_type)`,
      `CREATE INDEX IF NOT EXISTS idx_interactive_review_messages_session_id
        ON interactive_review_messages(session_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_interactive_review_resolutions_session_id
        ON interactive_review_resolutions(session_id, created_at)`
    ]
  },
  {
    id: "0009_add_interactive_review_resolved_at_index",
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_interactive_review_sessions_resolved_at
        ON interactive_review_sessions(resolved_at)`
    ]
  },
  {
    id: "0010_brainstorm_interactive",
    statements: [
      `CREATE TABLE IF NOT EXISTS brainstorm_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        last_assistant_message_id TEXT,
        last_user_message_id TEXT,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )`,
      `CREATE TABLE IF NOT EXISTS brainstorm_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        structured_payload_json TEXT,
        derived_updates_json TEXT,
        FOREIGN KEY (session_id) REFERENCES brainstorm_sessions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS brainstorm_drafts (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        problem TEXT,
        target_users_json TEXT NOT NULL,
        core_outcome TEXT,
        use_cases_json TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        non_goals_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        open_questions_json TEXT NOT NULL,
        candidate_directions_json TEXT NOT NULL,
        recommended_direction TEXT,
        scope_notes TEXT,
        assumptions_json TEXT NOT NULL,
        last_updated_at INTEGER NOT NULL,
        last_updated_from_message_id TEXT,
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (session_id) REFERENCES brainstorm_sessions(id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS brainstorm_drafts_session_revision_unique_idx
        ON brainstorm_drafts(session_id, revision)`,
      `CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_item_id
        ON brainstorm_sessions(item_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_brainstorm_messages_session_id
        ON brainstorm_messages(session_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_brainstorm_drafts_session_id
        ON brainstorm_drafts(session_id, revision)`
    ]
  },
  {
    id: "0011_app_verification_runtime",
    statements: [
      `ALTER TABLE workspace_settings ADD COLUMN app_test_config_json TEXT`,
      `CREATE TABLE IF NOT EXISTS app_verification_runs (
        id TEXT PRIMARY KEY NOT NULL,
        wave_story_execution_id TEXT NOT NULL,
        status TEXT NOT NULL,
        runner TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        project_app_test_context_json TEXT,
        story_context_json TEXT,
        prepared_session_json TEXT,
        result_json TEXT,
        artifacts_json TEXT,
        failure_summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (wave_story_execution_id) REFERENCES wave_story_executions(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_app_verification_runs_wave_story_execution_id
        ON app_verification_runs(wave_story_execution_id, created_at)`
    ]
  },
  {
    id: "0012_quality_integrations",
    statements: [
      `CREATE TABLE IF NOT EXISTS workspace_sonar_settings (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL,
        provider_type TEXT NOT NULL,
        host_url TEXT,
        organization TEXT,
        project_key TEXT,
        token_ref TEXT,
        default_branch TEXT,
        gating_mode TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        last_tested_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `CREATE TABLE IF NOT EXISTS workspace_coderabbit_settings (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL,
        provider_type TEXT NOT NULL,
        host_url TEXT,
        organization TEXT,
        repository TEXT,
        token_ref TEXT,
        default_branch TEXT,
        gating_mode TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        last_tested_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `CREATE TABLE IF NOT EXISTS quality_knowledge_entries (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        wave_id TEXT,
        story_id TEXT,
        source TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL,
        relevance_tags_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (wave_id) REFERENCES waves(id),
        FOREIGN KEY (story_id) REFERENCES user_stories(id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_knowledge_entries_workspace_scope_summary_unique
        ON quality_knowledge_entries(workspace_id, source, scope_type, scope_id, kind, summary)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_knowledge_entries_workspace_created_at
        ON quality_knowledge_entries(workspace_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_knowledge_entries_project_created_at
        ON quality_knowledge_entries(project_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_knowledge_entries_wave_created_at
        ON quality_knowledge_entries(wave_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_knowledge_entries_story_created_at
        ON quality_knowledge_entries(story_id, created_at)`
    ]
  },
  {
    id: "0013_workspace_assist_sessions",
    statements: [
      `CREATE TABLE IF NOT EXISTS workspace_assist_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_plan_json TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        last_assistant_message_id TEXT,
        last_user_message_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`,
      `CREATE TABLE IF NOT EXISTS workspace_assist_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        structured_payload_json TEXT,
        derived_plan_json TEXT,
        FOREIGN KEY (session_id) REFERENCES workspace_assist_sessions(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workspace_assist_sessions_workspace_id
        ON workspace_assist_sessions(workspace_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_workspace_assist_messages_session_id
        ON workspace_assist_messages(session_id, created_at)`
    ]
  },
  {
    id: "0014_planning_review_runtime",
    statements: [
      `CREATE TABLE IF NOT EXISTS planning_review_runs (
        id TEXT PRIMARY KEY NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        interaction_mode TEXT NOT NULL,
        review_mode TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        actual_mode TEXT NOT NULL,
        readiness TEXT,
        confidence TEXT NOT NULL,
        gate_eligibility TEXT NOT NULL,
        normalized_artifact_json TEXT NOT NULL,
        providers_used_json TEXT NOT NULL,
        missing_capabilities_json TEXT NOT NULL,
        review_summary TEXT,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        failed_reason TEXT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS planning_review_runs_source_started_unique_idx
        ON planning_review_runs(source_type, source_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_planning_review_runs_source
        ON planning_review_runs(source_type, source_id, started_at)`,
      `CREATE TABLE IF NOT EXISTS planning_review_findings (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        reviewer_role TEXT NOT NULL,
        finding_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        evidence TEXT,
        status TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES planning_review_runs(id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS planning_review_findings_run_fingerprint_unique_idx
        ON planning_review_findings(run_id, fingerprint)`,
      `CREATE INDEX IF NOT EXISTS idx_planning_review_findings_run
        ON planning_review_findings(run_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS planning_review_syntheses (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        readiness TEXT NOT NULL,
        key_points_json TEXT NOT NULL,
        disagreements_json TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES planning_review_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_planning_review_syntheses_run
        ON planning_review_syntheses(run_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS planning_review_questions (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        question TEXT NOT NULL,
        reason TEXT NOT NULL,
        impact TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        answered_at INTEGER,
        FOREIGN KEY (run_id) REFERENCES planning_review_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_planning_review_questions_run
        ON planning_review_questions(run_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS planning_review_assumptions (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        statement TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES planning_review_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_planning_review_assumptions_run
        ON planning_review_assumptions(run_id, created_at)`
    ]
  }
];

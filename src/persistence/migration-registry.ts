export type SqlMigration = {
  readonly id: string;
  readonly statements: readonly string[];
};

export const baseMigrations: readonly SqlMigration[] = [
  {
    id: "0000_initial",
    statements: [
      `CREATE TABLE IF NOT EXISTS __migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `PRAGMA foreign_keys = ON`,
      `CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        current_column TEXT NOT NULL,
        phase_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
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
  }
];

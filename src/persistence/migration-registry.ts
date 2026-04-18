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
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        actor TEXT NOT NULL,
        goal TEXT NOT NULL,
        benefit TEXT NOT NULL,
        acceptance_criteria_json TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        source_artifact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (source_artifact_id) REFERENCES artifacts(id)
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
];

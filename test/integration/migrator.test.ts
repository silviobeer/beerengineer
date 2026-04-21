import { describe, expect, it } from "vitest";

import { createSqliteConnection } from "../../src/persistence/database.js";
import { baseMigrations } from "../../src/persistence/migration-registry.js";
import { applyMigrations } from "../../src/persistence/migrator.js";
import { createTestDatabase } from "../helpers/database.js";

describe("migration runner", () => {
  it("applies migrations to an empty database and is idempotent", () => {
    const testDb = createTestDatabase();

    try {
      const appliedAgain = applyMigrations(testDb.connection, baseMigrations);

      expect(appliedAgain).toEqual([]);
    } finally {
      testDb.cleanup();
    }
  });

  it("can migrate a fresh connection without helper bootstrap", () => {
    const testDb = createTestDatabase();
    const secondConnection = createSqliteConnection(testDb.filePath.replace("test.sqlite", "fresh.sqlite"));

    try {
      const applied = applyMigrations(secondConnection, baseMigrations);
      const row = secondConnection
        .prepare("SELECT count(*) as count FROM __migrations")
        .get() as { count: number } | undefined;
      const indexes = secondConnection
        .prepare("PRAGMA index_list(qa_runs)")
        .all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0000_initial",
        "0001_add_verification_run_mode",
        "0002_add_qa_runtime_tables",
        "0003_add_story_review_runtime_tables",
        "0004_add_worker_prompt_skill_snapshots",
        "0005_add_documentation_runtime_tables",
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(row?.count).toBe(18);
      expect(indexes.map((index) => index.name)).toContain("idx_qa_runs_project_id");
    } finally {
      secondConnection.close();
      testDb.cleanup();
    }
  });

  it("adds verification_runs.mode for databases that already had the initial migration", () => {
    const testDb = createTestDatabase();
    const legacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "legacy.sqlite"));

    try {
      applyMigrations(legacyDb, [baseMigrations[0]!]);

      const applied = applyMigrations(legacyDb, baseMigrations);
      const columns = legacyDb.prepare("PRAGMA table_info(verification_runs)").all() as Array<{ name: string }>;
      const executionColumns = legacyDb.prepare("PRAGMA table_info(wave_story_executions)").all() as Array<{ name: string }>;
      const qaTables = legacyDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('qa_runs', 'qa_findings', 'qa_agent_sessions') ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0001_add_verification_run_mode",
        "0002_add_qa_runtime_tables",
        "0003_add_story_review_runtime_tables",
        "0004_add_worker_prompt_skill_snapshots",
        "0005_add_documentation_runtime_tables",
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(columns.map((column) => column.name)).toContain("mode");
      expect(executionColumns.map((column) => column.name)).toContain("system_prompt_snapshot");
      expect(qaTables.map((table) => table.name)).toEqual(["qa_agent_sessions", "qa_findings", "qa_runs"]);
    } finally {
      legacyDb.close();
      testDb.cleanup();
    }
  });

  it("adds QA indexes when the QA runtime migration is applied", () => {
    const testDb = createTestDatabase();
    const qaLegacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "qa-legacy.sqlite"));

    try {
      applyMigrations(qaLegacyDb, [baseMigrations[0]!, baseMigrations[1]!]);

      const applied = applyMigrations(qaLegacyDb, baseMigrations);
      const runIndexes = qaLegacyDb.prepare("PRAGMA index_list(qa_runs)").all() as Array<{ name: string }>;
      const findingIndexes = qaLegacyDb.prepare("PRAGMA index_list(qa_findings)").all() as Array<{ name: string }>;
      const sessionIndexes = qaLegacyDb.prepare("PRAGMA index_list(qa_agent_sessions)").all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0002_add_qa_runtime_tables",
        "0003_add_story_review_runtime_tables",
        "0004_add_worker_prompt_skill_snapshots",
        "0005_add_documentation_runtime_tables",
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(runIndexes.map((index) => index.name)).toContain("idx_qa_runs_project_id");
      expect(findingIndexes.map((index) => index.name)).toContain("idx_qa_findings_qa_run_id");
      expect(sessionIndexes.map((index) => index.name)).toContain("idx_qa_agent_sessions_qa_run_id");
    } finally {
      qaLegacyDb.close();
      testDb.cleanup();
    }
  });

  it("adds story review tables and indexes when the story review migration is applied", () => {
    const testDb = createTestDatabase();
    const reviewLegacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "story-review-legacy.sqlite"));

    try {
      applyMigrations(reviewLegacyDb, [baseMigrations[0]!, baseMigrations[1]!, baseMigrations[2]!]);

      const applied = applyMigrations(reviewLegacyDb, baseMigrations);
      const tables = reviewLegacyDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('story_review_runs', 'story_review_findings', 'story_review_agent_sessions') ORDER BY name")
        .all() as Array<{ name: string }>;
      const runIndexes = reviewLegacyDb.prepare("PRAGMA index_list(story_review_runs)").all() as Array<{ name: string }>;
      const findingIndexes = reviewLegacyDb.prepare("PRAGMA index_list(story_review_findings)").all() as Array<{ name: string }>;
      const sessionIndexes = reviewLegacyDb.prepare("PRAGMA index_list(story_review_agent_sessions)").all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0003_add_story_review_runtime_tables",
        "0004_add_worker_prompt_skill_snapshots",
        "0005_add_documentation_runtime_tables",
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(tables.map((table) => table.name)).toEqual([
        "story_review_agent_sessions",
        "story_review_findings",
        "story_review_runs"
      ]);
      expect(runIndexes.map((index) => index.name)).toContain("idx_story_review_runs_wave_story_execution_id");
      expect(findingIndexes.map((index) => index.name)).toContain("idx_story_review_findings_story_review_run_id");
      expect(sessionIndexes.map((index) => index.name)).toContain("idx_story_review_agent_sessions_story_review_run_id");
      const qaRunColumns = reviewLegacyDb.prepare("PRAGMA table_info(qa_runs)").all() as Array<{ name: string }>;
      expect(qaRunColumns.map((column) => column.name)).toContain("system_prompt_snapshot");
    } finally {
      reviewLegacyDb.close();
      testDb.cleanup();
    }
  });

  it("adds documentation tables and indexes when the documentation migration is applied", () => {
    const testDb = createTestDatabase();
    const documentationLegacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "documentation-legacy.sqlite"));

    try {
      applyMigrations(documentationLegacyDb, [
        baseMigrations[0]!,
        baseMigrations[1]!,
        baseMigrations[2]!,
        baseMigrations[3]!,
        baseMigrations[4]!
      ]);

      const applied = applyMigrations(documentationLegacyDb, baseMigrations);
      const tables = documentationLegacyDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('documentation_runs', 'documentation_agent_sessions') ORDER BY name")
        .all() as Array<{ name: string }>;
      const runIndexes = documentationLegacyDb.prepare("PRAGMA index_list(documentation_runs)").all() as Array<{ name: string }>;
      const sessionIndexes = documentationLegacyDb
        .prepare("PRAGMA index_list(documentation_agent_sessions)")
        .all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0005_add_documentation_runtime_tables",
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(tables.map((table) => table.name)).toEqual(["documentation_agent_sessions", "documentation_runs"]);
      expect(runIndexes.map((index) => index.name)).toContain("idx_documentation_runs_project_id");
      expect(sessionIndexes.map((index) => index.name)).toContain(
        "idx_documentation_agent_sessions_documentation_run_id"
      );
      const documentationColumns = documentationLegacyDb.prepare("PRAGMA table_info(documentation_runs)").all() as Array<{ name: string }>;
      expect(documentationColumns.map((column) => column.name)).toContain("stale_at");
    } finally {
      documentationLegacyDb.close();
      testDb.cleanup();
    }
  });

  it("adds remediation tables and execution git metadata when the remediation migration is applied", () => {
    const testDb = createTestDatabase();
    const remediationLegacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "remediation-legacy.sqlite"));

    try {
      applyMigrations(remediationLegacyDb, [
        baseMigrations[0]!,
        baseMigrations[1]!,
        baseMigrations[2]!,
        baseMigrations[3]!,
        baseMigrations[4]!,
        baseMigrations[5]!
      ]);

      const applied = applyMigrations(remediationLegacyDb, baseMigrations);
      const tables = remediationLegacyDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('story_review_remediation_runs', 'story_review_remediation_findings', 'story_review_remediation_agent_sessions') ORDER BY name")
        .all() as Array<{ name: string }>;
      const executionColumns = remediationLegacyDb.prepare("PRAGMA table_info(wave_story_executions)").all() as Array<{ name: string }>;
      const indexes = remediationLegacyDb
        .prepare("PRAGMA index_list(story_review_remediation_runs)")
        .all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0006_add_remediation_and_git_runtime_tables",
        "0007_add_workspaces",
        "0008_interactive_review",
        "0009_add_interactive_review_resolved_at_index",
        "0010_brainstorm_interactive",
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(tables.map((table) => table.name)).toEqual([
        "story_review_remediation_agent_sessions",
        "story_review_remediation_findings",
        "story_review_remediation_runs"
      ]);
      expect(executionColumns.map((column) => column.name)).toContain("git_branch_name");
      expect(indexes.map((index) => index.name)).toContain("idx_story_review_remediation_runs_story_id");
    } finally {
      remediationLegacyDb.close();
      testDb.cleanup();
    }
  });

  it("adds app verification runtime tables and workspace config when the app verification migration is applied", () => {
    const testDb = createTestDatabase();
    const verificationLegacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "app-verification-legacy.sqlite"));

    try {
      applyMigrations(verificationLegacyDb, baseMigrations.slice(0, 11));

      const applied = applyMigrations(verificationLegacyDb, baseMigrations);
      const tables = verificationLegacyDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('app_verification_runs', 'workspace_sonar_settings', 'workspace_coderabbit_settings', 'quality_knowledge_entries') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      const workspaceColumns = verificationLegacyDb.prepare("PRAGMA table_info(workspace_settings)").all() as Array<{ name: string }>;
      const runIndexes = verificationLegacyDb.prepare("PRAGMA index_list(app_verification_runs)").all() as Array<{ name: string }>;
      const qualityIndexes = verificationLegacyDb.prepare("PRAGMA index_list(quality_knowledge_entries)").all() as Array<{ name: string }>;

      expect(applied).toEqual([
        "0011_app_verification_runtime",
        "0012_quality_integrations",
        "0013_workspace_assist_sessions",
        "0016_review_core",
        "0017_workspace_runtime_profiles",
        "0018_execution_readiness",
        "0019_verification_readiness"
      ]);
      expect(tables.map((table) => table.name)).toEqual([
        "app_verification_runs",
        "quality_knowledge_entries",
        "workspace_coderabbit_settings",
        "workspace_sonar_settings"
      ]);
      expect(workspaceColumns.map((column) => column.name)).toContain("app_test_config_json");
      expect(runIndexes.map((index) => index.name)).toContain("idx_app_verification_runs_wave_story_execution_id");
      expect(qualityIndexes.map((index) => index.name)).toContain("idx_quality_knowledge_entries_story_created_at");
    } finally {
      verificationLegacyDb.close();
      testDb.cleanup();
    }
  });

  it("bootstraps workspace compatibility for legacy databases without workspace columns", () => {
    const testDb = createTestDatabase();
    const legacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "workspace-legacy.sqlite"));

    try {
      legacyDb.exec(`
        CREATE TABLE __migrations (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO __migrations (id, applied_at) VALUES ('0000_initial', 'legacy');
        CREATE TABLE items (
          id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          current_column TEXT NOT NULL,
          phase_status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      applyMigrations(legacyDb, []);

      const itemColumns = legacyDb.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
      const workspaceRow = legacyDb
        .prepare("SELECT key FROM workspaces WHERE id = ?")
        .get("workspace_default") as { key: string } | undefined;

      expect(itemColumns.map((column) => column.name)).toContain("workspace_id");
      expect(workspaceRow?.key).toBe("default");
    } finally {
      legacyDb.close();
      testDb.cleanup();
    }
  });

  it("rebuilds legacy items tables so duplicate item codes are allowed across workspaces", () => {
    const testDb = createTestDatabase();
    const legacyDb = createSqliteConnection(testDb.filePath.replace("test.sqlite", "workspace-legacy-unique.sqlite"));

    try {
      legacyDb.exec(`
        CREATE TABLE __migrations (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY NOT NULL,
          key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          root_path TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE workspace_settings (
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
          updated_at INTEGER NOT NULL
        );
        INSERT INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
        VALUES ('workspace_default', 'default', 'Default Workspace', NULL, NULL, 0, 0);
        INSERT INTO workspace_settings (workspace_id, created_at, updated_at)
        VALUES ('workspace_default', 0, 0);
        CREATE TABLE items (
          id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          current_column TEXT NOT NULL,
          phase_status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT 'workspace_default'
        );
        INSERT INTO items (id, code, title, description, current_column, phase_status, created_at, updated_at, workspace_id)
        VALUES ('item_one', 'ITEM-0001', 'One', 'Desc', 'idea', 'draft', 0, 0, 'workspace_default');
      `);

      applyMigrations(legacyDb, []);

      legacyDb
        .prepare(
          `INSERT INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, 0, 0)`
        )
        .run("workspace_two", "two", "Workspace Two");
      legacyDb
        .prepare(`INSERT INTO workspace_settings (workspace_id, created_at, updated_at) VALUES (?, 0, 0)`)
        .run("workspace_two");

      expect(() =>
        legacyDb
          .prepare(
            `INSERT INTO items (id, code, title, description, current_column, phase_status, created_at, updated_at, workspace_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run("item_two", "ITEM-0001", "Two", "Desc", "idea", "draft", 0, 0, "workspace_two")
      ).not.toThrow();
    } finally {
      legacyDb.close();
      testDb.cleanup();
    }
  });
});

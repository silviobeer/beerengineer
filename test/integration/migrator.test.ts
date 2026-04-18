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
        "0005_add_documentation_runtime_tables"
      ]);
      expect(row?.count).toBe(6);
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
        "0005_add_documentation_runtime_tables"
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
        "0005_add_documentation_runtime_tables"
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
        "0005_add_documentation_runtime_tables"
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

      expect(applied).toEqual(["0005_add_documentation_runtime_tables"]);
      expect(tables.map((table) => table.name)).toEqual(["documentation_agent_sessions", "documentation_runs"]);
      expect(runIndexes.map((index) => index.name)).toContain("idx_documentation_runs_project_id");
      expect(sessionIndexes.map((index) => index.name)).toContain(
        "idx_documentation_agent_sessions_documentation_run_id"
      );
    } finally {
      documentationLegacyDb.close();
      testDb.cleanup();
    }
  });
});

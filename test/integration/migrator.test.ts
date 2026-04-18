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

      expect(applied).toEqual(["0000_initial", "0001_add_verification_run_mode"]);
      expect(row?.count).toBe(2);
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

      expect(applied).toEqual(["0001_add_verification_run_mode"]);
      expect(columns.map((column) => column.name)).toContain("mode");
    } finally {
      legacyDb.close();
      testDb.cleanup();
    }
  });
});

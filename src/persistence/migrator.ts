import { PersistenceError } from "../shared/errors.js";
import type { SqliteDatabase } from "./database.js";
import type { SqlMigration } from "./migration-registry.js";

export function applyMigrations(
  connection: SqliteDatabase,
  migrations: readonly SqlMigration[]
): string[] {
  connection.exec(
    `CREATE TABLE IF NOT EXISTS __migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )`
  );

  const appliedRows = connection
    .prepare("SELECT id FROM __migrations")
    .all() as Array<{ id: string }>;
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const appliedNow: string[] = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    const transaction = connection.transaction(() => {
      for (const statement of migration.statements) {
        connection.exec(statement);
      }

      connection
        .prepare("INSERT INTO __migrations (id, applied_at) VALUES (?, ?)")
        .run(migration.id, new Date().toISOString());
    });

    try {
      transaction();
      appliedNow.push(migration.id);
    } catch (error) {
      throw new PersistenceError(`Failed to apply migration ${migration.id}`, {
        cause: error
      });
    }
  }

  return appliedNow;
}

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSqliteConnection } from "../../src/persistence/database.js";
import { baseMigrations } from "../../src/persistence/migration-registry.js";
import { applyMigrations } from "../../src/persistence/migrator.js";

export function createTestDatabase(): {
  readonly filePath: string;
  readonly connection: ReturnType<typeof createSqliteConnection>;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "beerengineer-test-"));
  const filePath = join(directory, "test.sqlite");
  const connection = createSqliteConnection(filePath);

  applyMigrations(connection, baseMigrations);

  return {
    filePath,
    connection,
    cleanup: () => {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

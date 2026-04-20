import { resolve } from "node:path";

import { createSqliteConnection } from "./database.js";
import { baseMigrations } from "./migration-registry.js";
import { applyMigrations } from "./migrator.js";
import { resolveDefaultDbPath } from "../shared/user-data-paths.js";

const targetPath = resolve(process.argv[2] ?? resolveDefaultDbPath());
const connection = createSqliteConnection(targetPath);

try {
  const applied = applyMigrations(connection, baseMigrations);
  const summary = applied.length > 0 ? applied.join(", ") : "no migrations pending";
  console.log(summary);
} finally {
  connection.close();
}

import { resolve } from "node:path";

import { createSqliteConnection } from "./database.js";

const targetPath = resolve(process.argv[2] ?? "./var/data/beerengineer.sqlite");
const connection = createSqliteConnection(targetPath);

try {
  const tables = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const tableNames = tables.map((row) => row.name);

  console.log(JSON.stringify({ path: targetPath, tables: tableNames }, null, 2));
} finally {
  connection.close();
}

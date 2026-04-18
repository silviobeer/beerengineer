import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export type DatabaseClient = ReturnType<typeof drizzle>;
export type SqliteDatabase = Database.Database;

export function createSqliteConnection(filePath: string): SqliteDatabase {
  const resolvedPath = resolve(filePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return new Database(resolvedPath);
}

export function createDatabase(filePath: string): {
  connection: SqliteDatabase;
  db: DatabaseClient;
} {
  const connection = createSqliteConnection(filePath);
  return {
    connection,
    db: drizzle(connection)
  };
}

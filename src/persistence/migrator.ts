import { PersistenceError } from "../shared/errors.js";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_KEY, DEFAULT_WORKSPACE_NAME } from "../shared/workspaces.js";
import type { SqliteDatabase } from "./database.js";
import type { SqlMigration } from "./migration-registry.js";

function tableExists(connection: SqliteDatabase, tableName: string): boolean {
  const row = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function columnExists(connection: SqliteDatabase, tableName: string, columnName: string): boolean {
  const columns = connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function indexExists(connection: SqliteDatabase, indexName: string): boolean {
  const row = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return row?.name === indexName;
}

function hasLegacyItemsCodeUniqueConstraint(connection: SqliteDatabase): boolean {
  const indexes = connection.prepare("PRAGMA index_list(items)").all() as Array<{
    name: string;
    origin: string;
    unique: number;
  }>;

  return indexes.some((index) => {
    if (index.origin !== "u" || index.unique !== 1 || !index.name.startsWith("sqlite_autoindex_items_")) {
      return false;
    }

    const columns = connection.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>;
    return columns.length === 1 && columns[0]?.name === "code";
  });
}

function rebuildLegacyItemsTable(connection: SqliteDatabase): void {
  const transaction = connection.transaction(() => {
    connection.exec("PRAGMA foreign_keys = OFF");
    connection.exec("ALTER TABLE items RENAME TO items_legacy_workspace_migration");
    connection.exec(
      `CREATE TABLE items (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        current_column TEXT NOT NULL,
        phase_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      )`
    );
    connection.exec(
      `INSERT INTO items (
        id,
        workspace_id,
        code,
        title,
        description,
        current_column,
        phase_status,
        created_at,
        updated_at
      )
      SELECT
        id,
        workspace_id,
        code,
        title,
        description,
        current_column,
        phase_status,
        created_at,
        updated_at
      FROM items_legacy_workspace_migration`
    );
    connection.exec("DROP TABLE items_legacy_workspace_migration");
    connection.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_workspace_code_unique ON items(workspace_id, code)");
    connection.exec("PRAGMA foreign_keys = ON");
  });

  transaction();
}

function defaultWorkspaceSeedPresent(connection: SqliteDatabase): boolean {
  const workspace = connection
    .prepare("SELECT id FROM workspaces WHERE id = ?")
    .get(DEFAULT_WORKSPACE_ID) as { id: string } | undefined;
  const settings = connection
    .prepare("SELECT workspace_id FROM workspace_settings WHERE workspace_id = ?")
    .get(DEFAULT_WORKSPACE_ID) as { workspace_id: string } | undefined;
  return workspace?.id === DEFAULT_WORKSPACE_ID && settings?.workspace_id === DEFAULT_WORKSPACE_ID;
}

function workspaceCompatibilitySatisfied(connection: SqliteDatabase): boolean {
  if (!tableExists(connection, "workspaces") || !tableExists(connection, "workspace_settings")) {
    return false;
  }

  if (!defaultWorkspaceSeedPresent(connection)) {
    return false;
  }

  if (!tableExists(connection, "items")) {
    return true;
  }

  if (!columnExists(connection, "items", "workspace_id")) {
    return false;
  }

  if (hasLegacyItemsCodeUniqueConstraint(connection)) {
    return false;
  }

  return indexExists(connection, "idx_items_workspace_code_unique");
}

function ensureWorkspaceCompatibility(connection: SqliteDatabase): void {
  // Fresh installs get workspace tables from the base schema. This compatibility
  // pass exists for older databases that predate the workspace layer and may
  // still carry the legacy global UNIQUE(code) constraint on items.
  if (workspaceCompatibilitySatisfied(connection)) {
    return;
  }
  const timestamp = 0;
  connection.exec(
    `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      root_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  );
  connection.exec(
    `CREATE TABLE IF NOT EXISTS workspace_settings (
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )`
  );
  connection
    .prepare(
      `INSERT OR IGNORE INTO workspaces (id, key, name, description, root_path, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_KEY, DEFAULT_WORKSPACE_NAME, timestamp, timestamp);
  connection
    .prepare(
      `INSERT OR IGNORE INTO workspace_settings (
        workspace_id,
        default_adapter_key,
        default_model,
        autorun_policy_json,
        prompt_overrides_json,
        skill_overrides_json,
        verification_defaults_json,
        qa_defaults_json,
        git_defaults_json,
        execution_defaults_json,
        ui_metadata_json,
        created_at,
        updated_at
      ) VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
    )
    .run(DEFAULT_WORKSPACE_ID, timestamp, timestamp);

  if (tableExists(connection, "items") && !columnExists(connection, "items", "workspace_id")) {
    connection.exec(
      `ALTER TABLE items ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`
    );
  }

  if (tableExists(connection, "items") && hasLegacyItemsCodeUniqueConstraint(connection)) {
    rebuildLegacyItemsTable(connection);
    return;
  }

  if (
    tableExists(connection, "items") &&
    columnExists(connection, "items", "workspace_id") &&
    !indexExists(connection, "idx_items_workspace_code_unique")
  ) {
    connection.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_workspace_code_unique ON items(workspace_id, code)");
  }
}

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

  ensureWorkspaceCompatibility(connection);

  return appliedNow;
}

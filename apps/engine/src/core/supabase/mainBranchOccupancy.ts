import { existsSync } from "node:fs"
import { join } from "node:path"
import { listSupabaseSqlFiles, type SupabaseMigrationClient } from "./migrationRunner.js"

export type MainBranchOccupancyResult = {
  occupancy: boolean
  requiresBaseline: boolean
  reason?: string
}

export async function detectMainBranchOccupancy(input: {
  client: SupabaseMigrationClient
  projectRef: string
  workspaceRoot: string
}): Promise<MainBranchOccupancyResult> {
  const result = await input.client.runQuery(
    input.projectRef,
    "main",
    "select count(*) as table_count from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
  ) as { rows?: Array<{ table_count?: number; tableCount?: number; count?: number }> }
  const first = result.rows?.[0]
  const tableCount = Number(first?.table_count ?? first?.tableCount ?? first?.count ?? 0)
  if (tableCount <= 0) return { occupancy: false, requiresBaseline: false }
  const migrationDir = join(input.workspaceRoot, "supabase", "migrations")
  const migrations = existsSync(migrationDir) ? listSupabaseSqlFiles(input.workspaceRoot).migrations : []
  if (migrations.length === 0) {
    return { occupancy: true, requiresBaseline: true, reason: "remote_schema_without_local_migrations" }
  }
  return { occupancy: true, requiresBaseline: false }
}

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export type SupabaseMigrationClient = {
  runQuery(projectRef: string, branchRef: string, sql: string): Promise<unknown>
}

export type MigrationApplyRecord = {
  path: string
  kind: "migration" | "seed"
}

function walkSql(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
      const full = join(root, entry.name)
      if (entry.isDirectory()) return walkSql(full)
      return entry.isFile() && entry.name.endsWith(".sql") ? [full] : []
    })
  } catch {
    return []
  }
}

function migrationTimestamp(path: string): string {
  const match = /(?:^|\/)(\d{14})_/.exec(path)
  if (!match) throw new Error(`Supabase migration lacks timestamp prefix: ${path}`)
  return match[1]
}

export function listSupabaseSqlFiles(workspaceRoot: string): { migrations: string[]; seeds: string[] } {
  const migrationRoot = join(workspaceRoot, "supabase", "migrations")
  const migrations = walkSql(migrationRoot)
  const sorted = [...migrations].sort((a, b) => migrationTimestamp(a).localeCompare(migrationTimestamp(b)) || a.localeCompare(b))
  const seen = new Set<string>()
  for (const file of sorted) {
    const timestamp = migrationTimestamp(file)
    if (seen.has(timestamp)) throw new Error(`Duplicate Supabase migration timestamp: ${timestamp}`)
    seen.add(timestamp)
  }
  const seedFiles = [
    join(workspaceRoot, "supabase", "seed.sql"),
    ...walkSql(join(workspaceRoot, "supabase", "seeds")),
  ].filter(path => {
    try { return statSync(path).isFile() } catch { return false }
  })
  return { migrations: sorted, seeds: seedFiles.sort() }
}

export async function applySupabaseMigrationsAndSeeds(input: {
  workspaceRoot: string
  projectRef: string
  branchRef: string
  client: SupabaseMigrationClient
}): Promise<MigrationApplyRecord[]> {
  const files = listSupabaseSqlFiles(input.workspaceRoot)
  const applied: MigrationApplyRecord[] = []
  for (const file of files.migrations) {
    await input.client.runQuery(input.projectRef, input.branchRef, readFileSync(file, "utf8"))
    applied.push({ path: relative(input.workspaceRoot, file), kind: "migration" })
  }
  for (const file of files.seeds) {
    await input.client.runQuery(input.projectRef, input.branchRef, readFileSync(file, "utf8"))
    applied.push({ path: relative(input.workspaceRoot, file), kind: "seed" })
  }
  return applied
}

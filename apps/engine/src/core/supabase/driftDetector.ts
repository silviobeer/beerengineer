import { readdirSync } from "node:fs"
import { basename, join } from "node:path"

export type SupabaseDriftReport = {
  status: "ready" | "drifted" | "failed"
  missingMigrations: string[]
  extraMigrations: string[]
  identityDrift: string[]
  reason?: string
}

function repoMigrationNames(workspaceRoot: string): string[] {
  try {
    return readdirSync(join(workspaceRoot, "supabase", "migrations"))
      .filter(name => name.endsWith(".sql"))
      .map(name => basename(name))
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
}

export function detectSupabaseDrift(input: {
  workspaceRoot: string
  appliedMigrations: string[]
  seedIdentityRows?: Array<{ id: string; expected: unknown; actual: unknown }>
}): SupabaseDriftReport {
  const repo = repoMigrationNames(input.workspaceRoot)
  const applied = input.appliedMigrations.map(name => basename(name)).sort()
  const missingMigrations = repo.filter(name => !applied.includes(name))
  const extraMigrations = applied.filter(name => !repo.includes(name))
  const identityDrift = (input.seedIdentityRows ?? [])
    .filter(row => JSON.stringify(row.expected) !== JSON.stringify(row.actual))
    .map(row => row.id)
  return {
    status: missingMigrations.length || extraMigrations.length || identityDrift.length ? "drifted" : "ready",
    missingMigrations,
    extraMigrations,
    identityDrift,
  }
}

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { SupabaseMigrationClient } from "../migrationRunner.js"

function walk(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
      const full = join(root, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && entry.name.endsWith(".sql") ? [full] : []
    })
  } catch {
    return []
  }
}

export async function runSqlAssertions(input: {
  workspaceRoot: string
  projectRef: string
  branchRef: string
  client: SupabaseMigrationClient
}): Promise<string[]> {
  const files = walk(join(input.workspaceRoot, "supabase", "tests")).sort()
  for (const file of files) {
    await input.client.runQuery(input.projectRef, input.branchRef, readFileSync(file, "utf8"))
  }
  return files.map(file => relative(input.workspaceRoot, file))
}

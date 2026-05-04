import { spawnSync } from "node:child_process"

export function trackedSupabaseHandoffFiles(workspaceRoot: string): string[] {
  const result = spawnSync("git", ["ls-files", ".beerengineer/handoff/supabase/"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

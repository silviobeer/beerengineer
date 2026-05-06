import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("PROJ-6 PRD-3 US-2: workspace Supabase setup routes use route-key endpoints", () => {
  const server = readFileSync("src/api/server.ts", "utf8")
  const routes = readFileSync("src/api/routes/workspaces.ts", "utf8")
  assert.match(server, /workspaces\\\/\(\[\^\/\]\+\)\\\/supabase\\\/\(readiness\|connect\|rotate\|branch\)/)
  assert.match(server, /handleWorkspaceSupabaseReadiness\(repos, res, key/)
  assert.match(server, /handleWorkspaceSupabaseConnect\(repos, req, res, key\)/)
  assert.match(server, /handleWorkspaceSupabaseBranch\(repos, res, key\)/)
  assert.match(routes, /getWorkspaceByKey\(key\)/)
  assert.match(routes, /workspaceId: workspace.id/)
})

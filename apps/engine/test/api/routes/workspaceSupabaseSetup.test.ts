import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { listImplementedApiRouteSurface } from "../../../src/api/routeRegistration.js"

test("PROJ-6 PRD-3 US-2: workspace Supabase setup routes use route-key endpoints", () => {
  const routes = readFileSync("src/api/routes/workspaces.ts", "utf8")
  const surface = listImplementedApiRouteSurface()
  assert.ok(surface.includes("GET /workspaces/{key}/supabase/readiness"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/connect"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/rotate"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/branch"))
  assert.match(routes, /getWorkspaceByKey\(key\)/)
  assert.match(routes, /workspaceId: workspace.id/)
  assert.ok(routes.includes('const mode = body.mode === "attach" ? "attach" : "create"'))
})

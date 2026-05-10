import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { listImplementedApiRouteSurface } from "../../../src/api/routeRegistration.js"

test("PROJ-6 PRD-3 US-4: engine exposes same-run Supabase readiness retry endpoint", () => {
  const runs = readFileSync("src/api/routes/runs.ts", "utf8")
  const start = runs.indexOf("export async function handleSupabaseReadinessRetry")
  const end = runs.indexOf("/** `POST /runs`", start)
  const retryHandler = runs.slice(start, end)
  assert.ok(listImplementedApiRouteSurface().includes("POST /runs/{id}/supabase-readiness/retry"))
  assert.match(retryHandler, /handleSupabaseReadinessRetry/)
  assert.match(retryHandler, /resumeRunInProcess/)
  assert.doesNotMatch(retryHandler, /createRun\(/)
})

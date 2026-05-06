import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("PROJ-6 PRD-3 US-4: engine exposes same-run Supabase readiness retry endpoint", () => {
  const server = readFileSync("src/api/server.ts", "utf8")
  const runs = readFileSync("src/api/routes/runs.ts", "utf8")
  const start = runs.indexOf("export async function handleSupabaseReadinessRetry")
  const end = runs.indexOf("/** `POST /runs`", start)
  const retryHandler = runs.slice(start, end)
  assert.match(server, /runs\\\/\(\[\^\/\]\+\)\\\/supabase-readiness\\\/retry/)
  assert.match(retryHandler, /handleSupabaseReadinessRetry/)
  assert.match(retryHandler, /resumeRunInProcess/)
  assert.doesNotMatch(retryHandler, /createRun\(/)
})

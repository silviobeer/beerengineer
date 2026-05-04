import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("PROJ-4 PRD-8 US-2: engine exposes typed-confirm destroy route", () => {
  const server = readFileSync("apps/engine/src/api/server.ts", "utf8")
  const routes = readFileSync("apps/engine/src/api/routes/setup.ts", "utf8")
  assert.match(server, /POST \/setup\/supabase\/destroy/)
  assert.match(routes, /confirmedName/)
  assert.match(routes, /confirmation_mismatch/)
})

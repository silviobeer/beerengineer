import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("PROJ-4 PRD-3 US-5: engine exposes supabase token rotation route", () => {
  const server = readFileSync("apps/engine/src/api/server.ts", "utf8")
  assert.match(server, /POST \/setup\/supabase\/rotate/)
  assert.match(server, /POST \/setup\/supabase\/disconnect/)
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("PROJ-4 PRD-2 US-1: engine exposes a setup Supabase connect route", () => {
  const server = readFileSync(new URL("../../../src/api/server.ts", import.meta.url), "utf8")
  assert.match(server, /POST \/setup\/supabase\/connect/)
})

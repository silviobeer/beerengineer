import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const serverSourcePath = resolve(here, "../../../src/api/server.ts")

test("PROJ-4 PRD-3 US-5: engine exposes supabase token rotation route", () => {
  const server = readFileSync(serverSourcePath, "utf8")
  assert.match(server, /POST \/setup\/supabase\/rotate/)
  assert.match(server, /POST \/setup\/supabase\/disconnect/)
})

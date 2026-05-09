import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, "..", "..", "..")
const conceptPath = resolve(repoRoot, "specs/PROJ-8-workflow-capability-safety/1_brainstorm/PROJ-8-concept.md")

test("PROJ-8-PRD-3-US-3: PROJ-8 concept keeps production migration activation out of scope", () => {
  const concept = readFileSync(conceptPath, "utf8")

  assert.match(concept, /Supabase production migration activation or rollback improvements after explicit product and architecture approval\./)
  assert.match(concept, /Success means parity and safety proof, not full Supabase production migration activation\./)
  assert.match(concept, /must not introduce new irreversible production migration behavior\./)
})

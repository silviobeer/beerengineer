import { test } from "node:test"
import assert from "node:assert/strict"

import { detectDbRelevance } from "../../../src/core/dbRelevance/detector.js"

test("PROJ-4 PRD-4 US-2: detector reports path, import, and SQL signals", () => {
  const result = detectDbRelevance({
    changedFiles: ["supabase/migrations/20260504120000_create_table.sql", "src/db.ts", "docs/note.md"],
    previousFileContents: { "src/db.ts": "" },
    fileContents: {
      "src/db.ts": "import { createClient } from '@supabase/supabase-js'",
      "docs/note.md": "```sql\nDROP TABLE demo\n```",
    },
  })
  assert.deepEqual(result.signals.map(signal => signal.kind), ["path", "import", "sql"])
  for (const signal of result.signals) {
    assert.equal(typeof signal.path, "string")
    assert.equal(typeof signal.reason, "string")
  }
})

test("PROJ-4 PRD-4 US-2: detector excludes vendored paths", () => {
  assert.equal(detectDbRelevance({
    changedFiles: ["node_modules/pkg/migration.sql"],
    fileContents: { "node_modules/pkg/migration.sql": "create table demo(id int)" },
  }).signals.length, 0)
})

test("PROJ-4 PRD-4 US-2: detector ignores unchanged workspace Postgres client imports", () => {
  assert.equal(detectDbRelevance({
    changedFiles: ["src/db.ts"],
    workspacePostgresClients: ["postgres"],
    previousFileContents: { "src/db.ts": "import postgres from 'postgres'" },
    fileContents: { "src/db.ts": "import postgres from 'postgres'\nexport const touched = true" },
  }).signals.length, 0)
  assert.equal(detectDbRelevance({
    changedFiles: ["src/new-db.ts"],
    workspacePostgresClients: ["postgres"],
    previousFileContents: { "src/new-db.ts": "" },
    fileContents: { "src/new-db.ts": "import postgres from 'postgres'" },
  }).signals.length, 1)
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { detectDestructiveMigrations } from "../../../src/core/supabase/destructiveDetector.js"

test("PROJ-4 PRD-7 US-3: destructive detector scans migration set", () => {
  const findings = detectDestructiveMigrations({
    populatedTables: ["users"],
    migrations: [
      { file: "001.sql", sql: "-- drop table ignored\nDROP TABLE accounts;\nALTER TABLE users DROP COLUMN name;\nDROP POLICY p ON users;" },
      { file: "002.sql", sql: "alter table users alter column email type integer;\nalter table users alter column email set not null;\ncreate table accounts(id int);" },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["drop-table", "drop-column", "policy-removal", "destructive-type-rewrite", "non-null-add-without-default-on-populated-table"])
  assert.equal(findings.some(f => f.file === "002.sql"), true)
})

test("PROJ-4 PRD-7 US-3: destructive detector ignores comments and quoted literals", () => {
  const findings = detectDestructiveMigrations({
    populatedTables: ["users"],
    migrations: [
      {
        file: "003.sql",
        sql: [
          "select '-- drop table users' as text;",
          "/*",
          "drop table ignored;",
          "*/",
          "alter table public.users alter column email set not null;",
        ].join("\n"),
      },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["non-null-add-without-default-on-populated-table"])
  assert.equal(findings[0].line, 5)
})

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

test("PROJ-4 QA-008: destructive detector scans dollar-quoted function bodies (untagged)", () => {
  // Postgres dollar-quoting ($$ ... $$) is a string-literal delimiter, but the
  // body executes when the function runs — a DROP TABLE inside CREATE FUNCTION
  // is a real destructive action that must trigger a finding.
  // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-DOLLAR-QUOTING
  const findings = detectDestructiveMigrations({
    migrations: [
      {
        file: "nuke.sql",
        sql: "CREATE FUNCTION nuke() RETURNS void AS $$ DROP TABLE users; $$ LANGUAGE plpgsql;",
      },
    ],
  })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, "drop-table")
  assert.equal(findings[0].file, "nuke.sql")
})

test("PROJ-4 QA-008: destructive detector scans tagged dollar-quoted bodies", () => {
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "tagged.sql", sql: "$body$ DROP TABLE y; $body$" },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["drop-table"])
})

test("PROJ-4 QA-008: dollar-quoted body inside CREATE FUNCTION across multiple lines", () => {
  const findings = detectDestructiveMigrations({
    migrations: [
      {
        file: "fn.sql",
        sql: [
          "create function demo() returns void as $$",
          "begin",
          "  drop table internal_temp;",
          "end",
          "$$ language plpgsql;",
          "drop table actual_data;",
        ].join("\n"),
      },
    ],
  })
  // Both DROPs are real findings — the inner one (line 3) and the outer one (line 6).
  assert.deepEqual(findings.map(f => f.kind), ["drop-table", "drop-table"])
  assert.equal(findings[0].line, 3)
  assert.equal(findings[1].line, 6)
})

test("PROJ-4 QA-016: backslash inside single-quoted string does not escape the closing quote", () => {
  // Postgres default standard_conforming_strings=on (since 9.1) treats
  // backslash as ordinary inside single-quoted strings; only doubled '' escapes
  // a quote. So '\\' closes at the second character, and `; DROP TABLE z; --`
  // that follows is unquoted SQL that must trigger a finding.
  // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "esc.sql", sql: "select '\\'; DROP TABLE z; --'" },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["drop-table"])
})

test("PROJ-4 QA-016: doubled single quote escape keeps string intact", () => {
  // 'literal '' inside' is a single string with an embedded apostrophe — no
  // DROP TABLE finding should fire because there is no DROP outside the string.
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "ok.sql", sql: "select 'literal '' inside' as t;" },
    ],
  })
  assert.deepEqual(findings, [])
})

test("PROJ-4 block-comment-collapse: /**/ collapse must not splice keywords together", () => {
  // Postgres treats block comments as whitespace at the lexer level, so
  // DROP/**/TABLE x lexes as DROP TABLE x and must trigger a finding.
  // Ref: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-COMMENTS
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "collapse.sql", sql: "DROP/**/TABLE w;" },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["drop-table"])
})

test("PROJ-4 block-comment-collapse: /* drop table */ outside word boundary stays ignored", () => {
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "ok2.sql", sql: "/* drop table */ SELECT 1;" },
    ],
  })
  assert.deepEqual(findings, [])
})

test("PROJ-4 line comment with DROP TABLE remains ignored", () => {
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "linecmt.sql", sql: "-- DROP TABLE foo" },
    ],
  })
  assert.deepEqual(findings, [])
})

test("PROJ-4 multi-statement on one line still detected", () => {
  const findings = detectDestructiveMigrations({
    migrations: [
      { file: "multi.sql", sql: "SELECT 1; DROP TABLE users;" },
    ],
  })
  assert.deepEqual(findings.map(f => f.kind), ["drop-table"])
})

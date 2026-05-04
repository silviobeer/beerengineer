import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSqlAssertions } from "../../../../src/core/supabase/dbTests/sqlAssertionRunner.js"

test("PROJ-4 PRD-5 US-4: optional SQL assertions run in filename order and absence is ok", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-sql-assert-"))
  const calls: string[] = []
  try {
    assert.deepEqual(await runSqlAssertions({ workspaceRoot: dir, projectRef: "proj", branchRef: "br", client: { runQuery: async () => undefined } }), [])
    mkdirSync(join(dir, "supabase", "tests"), { recursive: true })
    writeFileSync(join(dir, "supabase", "tests", "b.sql"), "select b")
    writeFileSync(join(dir, "supabase", "tests", "a.sql"), "select a")
    const ran = await runSqlAssertions({ workspaceRoot: dir, projectRef: "proj", branchRef: "br", client: { runQuery: async (_p, _b, sql) => { calls.push(sql) } } })
    assert.deepEqual(ran, ["supabase/tests/a.sql", "supabase/tests/b.sql"])
    assert.deepEqual(calls, ["select a", "select b"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

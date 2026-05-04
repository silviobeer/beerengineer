import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureSupabaseHandoffGitignore } from "../../../src/core/supabase/handoffWriter.js"

test("PROJ-4 PRD-6 US-2: setup gitignore includes supabase handoff path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-gitignore-"))
  try {
    assert.equal(await ensureSupabaseHandoffGitignore(dir), true)
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /\.beerengineer\/handoff\/supabase\//)
    assert.equal(await ensureSupabaseHandoffGitignore(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

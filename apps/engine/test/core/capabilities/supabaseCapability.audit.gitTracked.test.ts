import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createSupabaseCapability } from "../../../src/core/capabilities/supabaseCapability.js"

test("PROJ-4 PRD-6 US-2: supabase audit fails on git-tracked handoff files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-audit-"))
  try {
    spawnSync("git", ["init"], { cwd: dir })
    mkdirSync(join(dir, ".beerengineer", "handoff", "supabase", "run"), { recursive: true })
    writeFileSync(join(dir, ".beerengineer", "handoff", "supabase", "run", "wave.env"), "SUPABASE_URL=x")
    spawnSync("git", ["add", "-f", ".beerengineer/handoff/supabase/run/wave.env"], { cwd: dir })
    const result = await createSupabaseCapability({ workspace: { rootPath: dir } }).ports.audit!()
    assert.equal(result.status, "failed")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

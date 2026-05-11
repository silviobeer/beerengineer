import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { handleWorkspaceSupabaseReadiness } from "../../../src/api/routes/workspaces.js"

function responseRecorder() {
  let status = 0
  let body = ""
  return {
    res: {
      writeHead(code: number) { status = code; return this },
      end(chunk: string) { body += chunk },
    },
    result: () => ({ status, body: JSON.parse(body) as Record<string, unknown> }),
  }
}

test("PROJ-6 PRD-3 US-1: readiness resolves workspace by route key server-side", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-readiness-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: join(dir, "alpha") })
  repos.upsertWorkspace({ key: "beta", name: "Beta", rootPath: join(dir, "beta") })
  try {
    const rec = responseRecorder()
    await handleWorkspaceSupabaseReadiness(repos, rec.res as never, "beta")
    const out = rec.result()
    assert.equal(out.status, 200)
    assert.equal(((out.body.readiness as Record<string, unknown>).workspace as Record<string, unknown>).key, "beta")
    assert.match(JSON.stringify(out.body), /Connect Supabase project/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-14 REQ-4 AC-4.1: readiness payload exposes authoritative workspace dbMode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-readiness-mode-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const direct = repos.upsertWorkspace({ key: "direct", name: "Direct", rootPath: join(dir, "direct") })
  const branching = repos.upsertWorkspace({ key: "branching", name: "Branching", rootPath: join(dir, "branching") })
  repos.connectWorkspaceSupabase(direct.id, { projectRef: "proj_direct", region: "eu", dbMode: "direct" })
  repos.connectWorkspaceSupabase(branching.id, { projectRef: "proj_branching", region: "eu", dbMode: "branching" })
  repos.setWorkspaceSupabasePersistentBranch(branching.id, { ref: "br_1", name: "persistent", status: "ACTIVE_HEALTHY" })
  try {
    const directRec = responseRecorder()
    await handleWorkspaceSupabaseReadiness(repos, directRec.res as never, "direct")
    const directOut = directRec.result()
    assert.equal(directOut.status, 200)
    assert.equal((((directOut.body.readiness as Record<string, unknown>).workspace as Record<string, unknown>).dbMode), "direct")

    const branchingRec = responseRecorder()
    await handleWorkspaceSupabaseReadiness(repos, branchingRec.res as never, "branching")
    const branchingOut = branchingRec.result()
    assert.equal(branchingOut.status, 200)
    assert.equal((((branchingOut.body.readiness as Record<string, unknown>).workspace as Record<string, unknown>).dbMode), "branching")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

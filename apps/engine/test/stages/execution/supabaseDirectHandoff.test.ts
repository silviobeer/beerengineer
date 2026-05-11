import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { provisionWaveIfDbRelevant } from "../../../src/stages/execution/supabaseWaveGate.js"
import { supabaseHandoffPath } from "../../../src/core/supabase/handoffWriter.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import type { WaveDefinition } from "../../../src/types.js"

test("REQ-3 AC-3.1/AC-3.4: direct-mode DB waves write the standard handoff artifact without branch provisioning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-direct-wave-handoff-"))
  const storePath = join(dir, "secrets.json")
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_direct_wave", { storePath })
  const wave: WaveDefinition = {
    id: "W2",
    number: 2,
    goal: "db wave",
    kind: "feature",
    stories: [{ id: "REQ-3", title: "direct handoff", dbRelevant: true }],
    dbRelevantStoryCount: 1,
    dbRelevantWave: true,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }

  try {
    const result = await provisionWaveIfDbRelevant({
      wave,
      adapter: {
        provisionBranch: async () => { throw new Error("direct mode must not provision a branch") },
        pollBranchStatus: async () => { throw new Error("direct mode must not poll a branch") },
        validateBranch: async () => { throw new Error("direct mode must not validate a branch") },
        destroyBranch: async () => ({ ok: true }),
        migrateProduction: async () => ({ ok: true }),
        reconcile: async () => ({ ok: true }),
      },
      context: {
        workspaceId: "ws-direct",
        workspaceRoot: dir,
        runId: "run-direct",
        projectRef: "proj_direct",
        dbMode: "direct",
        branchRef: "stale_branch_metadata",
      },
      handoffClient: {
        getProjectKeys: async (_projectRef, branchRef) => {
          assert.equal(branchRef, undefined)
          return { url: "https://proj_direct.supabase.co", anonKey: "anon_direct", serviceRoleKey: "service_direct" }
        },
        getBranchConnectionString: async () => {
          throw new Error("direct mode must not request a branch connection string")
        },
      },
    })

    assert.deepEqual(result, {
      ok: true,
      branchRef: "",
      handoffPath: supabaseHandoffPath(dir, "run-direct", "W2"),
    })
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /\.beerengineer\/handoff\/supabase\//)
    const content = readFileSync(supabaseHandoffPath(dir, "run-direct", "W2"), "utf8")
    assert.match(content, /SUPABASE_URL=https:\/\/proj_direct\.supabase\.co/)
    assert.match(content, /SUPABASE_ANON_KEY=anon_direct/)
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY=/)
    assert.doesNotMatch(content, /SUPABASE_DB_URL=/)
    assert.doesNotMatch(content, /stale_branch_metadata/)
    assert.match(content, /automatic production migration is skipped/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

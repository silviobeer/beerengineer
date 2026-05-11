import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"
import { provisionWaveIfDbRelevant } from "../../../src/stages/execution/supabaseWaveGate.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import type { WaveDefinition } from "../../../src/types.js"

test("REQ-2 AC-2.4: stale-reference recovery still flows through provision, poll, handoff, then validate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-gate-recovery-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const secretStorePath = join(dir, "secrets.json")
  const previousSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  process.env.BEERENGINEER_SECRET_STORE_PATH = secretStorePath
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_wave_gate_recovery", { storePath: secretStorePath })

  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  repos.setRunSupabaseBranch(run.id, { ref: "br_old", name: "beerengineer-demo-old-run-old-item-project-1-wave-0", lifecycleState: "ready" })

  const wave: WaveDefinition = {
    id: "wave-1",
    number: 1,
    goal: "db wave",
    kind: "feature",
    stories: [{ id: "REQ-2", title: "recover stale ref", dbRelevant: true }],
    dbRelevantStoryCount: 1,
    dbRelevantWave: true,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }

  const expectedName = `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`
  const realAdapter = createSupabaseAdapter({
    repos,
    client: {
      listBranches: async () => [{ id: "br_wave", ref: "br_wave", name: expectedName, status: "ACTIVE_HEALTHY" }],
      createBranch: async () => {
        throw new Error("stale recovery should reuse the verified current-wave branch")
      },
      getBranch: async (_projectRef, branchRef) => {
        if (branchRef === "br_old") return { id: "br_old", ref: "br_old", name: "beerengineer-demo-old-run-old-item-project-1-wave-0", status: "ACTIVE_HEALTHY" }
        throw new Error(`unexpected branch lookup: ${branchRef}`)
      },
      runQuery: async () => undefined,
    },
  })

  const steps: string[] = []
  try {
    const result = await provisionWaveIfDbRelevant({
      wave,
      adapter: {
        provisionBranch: async context => {
          steps.push("provision")
          return realAdapter.provisionBranch(context)
        },
        pollBranchStatus: async context => {
          steps.push("poll")
          assert.equal(context.branchRef, "br_wave")
          return { ok: true, context: { status: "ready" } }
        },
        validateBranch: async context => {
          steps.push("validate")
          assert.equal(context.branchRef, "br_wave")
          return { ok: true, context: { status: "validated" } }
        },
        destroyBranch: async () => ({ ok: true }),
        migrateProduction: async () => ({ ok: true }),
        reconcile: async () => ({ ok: true }),
      },
      context: {
        workspaceId: workspace.id,
        workspaceKey: workspace.key,
        workspaceRoot: dir,
        runId: run.id,
        itemId: item.id,
        projectId: "project-1",
        projectRef: "proj_1",
        parentBranchRef: "br_persistent",
        dbMode: "branching",
      },
      handoffClient: {
        getProjectKeys: async (_projectRef, branchRef) => {
          steps.push("handoff")
          assert.equal(branchRef, "br_wave")
          return { url: "https://proj_1.supabase.co", anonKey: "anon", serviceRoleKey: "service" }
        },
        getBranchConnectionString: async (_projectRef, branchRef) => {
          assert.equal(branchRef, "br_wave")
          return "postgres://user:pass@localhost:5432/db"
        },
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(steps, ["provision", "poll", "handoff", "validate"])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "br_wave")
    assert.equal(repos.getRun(run.id)?.supabase_branch_name, expectedName)
  } finally {
    if (previousSecretStorePath == null) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStorePath
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

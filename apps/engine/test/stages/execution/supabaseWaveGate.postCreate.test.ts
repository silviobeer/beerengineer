import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { buildSupabaseWorkflowHook } from "../../../src/core/runOrchestrator.js"
import { SupabaseManagementClient } from "../../../src/core/supabase/managementClient.js"
import { provisionWaveIfDbRelevant } from "../../../src/stages/execution/supabaseWaveGate.js"
import { storeSecret } from "../../../src/setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import { supabaseHandoffPath } from "../../../src/core/supabase/handoffWriter.js"
import type { WaveDefinition } from "../../../src/types.js"

function wave(): WaveDefinition {
  return {
    id: "wave-1",
    number: 1,
    goal: "db wave",
    kind: "feature",
    stories: [{ id: "REQ-1", title: "post-create regression", dbRelevant: true }],
    dbRelevantStoryCount: 1,
    dbRelevantWave: true,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }
}

test("REQ-1 AC-1.1/AC-1.2: branch-backed post-create flow completes when the hook factory also exposes a shared management client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-gate-post-create-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const secretStorePath = join(dir, "secrets.json")
  const previousSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  process.env.BEERENGINEER_SECRET_STORE_PATH = secretStorePath
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_wave_gate_post_create", { storePath: secretStorePath })

  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu-central-1" })
  repos.setWorkspaceSupabasePersistentBranch(workspace.id, {
    ref: "br_parent",
    name: "branch-parent",
    status: "ACTIVE_HEALTHY",
  })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })

  const fetchCalls: string[] = []
  const managementClient = new SupabaseManagementClient({
    token: "sbp_wave_gate_post_create",
    baseUrl: "https://example.test",
    fetch: (async (url) => {
      const requestUrl = String(url)
      fetchCalls.push(requestUrl)
      if (requestUrl.endsWith("/branches/br_wave/api-keys")) {
        return Response.json({
          url: "https://proj_1.supabase.co",
          anonKey: "anon_branch",
          serviceRoleKey: "service_branch",
        })
      }
      if (requestUrl.endsWith("/branches/br_wave/connection-string")) {
        return Response.json({
          connectionString: "postgres://user:pass@localhost:5432/db",
        })
      }
      throw new Error(`unexpected request: ${requestUrl}`)
    }) as typeof fetch,
  })

  try {
    const hook = buildSupabaseWorkflowHook(
      repos,
      workspace.id,
      repos.getWorkspace(workspace.id),
      () => ({
        adapter: {
          provisionBranch: async () => ({ ok: true, context: { branchRef: "br_wave" } }),
          pollBranchStatus: async context => {
            assert.equal(context.branchRef, "br_wave")
            return { ok: true, context: { status: "ready" } }
          },
          validateBranch: async context => {
            assert.equal(context.branchRef, "br_wave")
            return { ok: true, context: { status: "validated" } }
          },
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
        managementClient,
        handoffClient: {
          getProjectKeys: managementClient.getProjectKeys,
          getBranchConnectionString: managementClient.getBranchConnectionString,
        },
      }),
    )

    assert.ok(hook, "expected Supabase workflow hook")

    const result = await provisionWaveIfDbRelevant({
      wave: wave(),
      adapter: hook.adapter,
      repos,
      handoffClient: hook.handoffClient,
      context: {
        workspaceId: workspace.id,
        workspaceKey: workspace.key,
        workspaceRoot: dir,
        runId: run.id,
        itemId: item.id,
        projectId: "project-1",
        projectRef: "proj_1",
        parentBranchRef: "br_parent",
        dbMode: "branching",
      },
    })

    assert.deepEqual(result, {
      ok: true,
      branchRef: "br_wave",
      handoffPath: supabaseHandoffPath(dir, run.id, "wave-1"),
    })
    assert.deepEqual(fetchCalls, [
      "https://example.test/projects/proj_1/branches/br_wave/api-keys",
      "https://example.test/projects/proj_1/branches/br_wave/connection-string",
    ])
    const handoff = readFileSync(supabaseHandoffPath(dir, run.id, "wave-1"), "utf8")
    assert.match(handoff, /SUPABASE_URL=https:\/\/proj_1\.supabase\.co/)
    assert.match(handoff, /SUPABASE_DB_URL=postgres:\/\/user:pass@localhost:5432\/db/)
    assert.doesNotMatch(handoff, /Cannot read properties of undefined \(reading 'request'\)/)
  } finally {
    if (previousSecretStorePath == null) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStorePath
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.3: legitimate post-create handoff failures remain surfaced after branch creation succeeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-gate-post-create-failure-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const secretStorePath = join(dir, "secrets.json")
  const previousSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  process.env.BEERENGINEER_SECRET_STORE_PATH = secretStorePath
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp_wave_gate_post_create_failure", { storePath: secretStorePath })

  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu-central-1" })
  repos.setWorkspaceSupabasePersistentBranch(workspace.id, {
    ref: "br_parent",
    name: "branch-parent",
    status: "ACTIVE_HEALTHY",
  })

  try {
    const hook = buildSupabaseWorkflowHook(
      repos,
      workspace.id,
      repos.getWorkspace(workspace.id),
      () => ({
        adapter: {
          provisionBranch: async () => ({ ok: true, context: { branchRef: "br_wave" } }),
          pollBranchStatus: async () => ({ ok: true, context: { status: "ready" } }),
          validateBranch: async () => ({ ok: true, context: { status: "validated" } }),
          destroyBranch: async () => ({ ok: true }),
          migrateProduction: async () => ({ ok: true }),
          reconcile: async () => ({ ok: true }),
        },
        managementClient: new SupabaseManagementClient({
          token: "sbp_wave_gate_post_create_failure",
          fetch: (async () => Response.json({ message: "Provider rejected keys request" }, { status: 500 })) as typeof fetch,
        }),
      }),
    )

    assert.ok(hook, "expected Supabase workflow hook")

    const result = await provisionWaveIfDbRelevant({
      wave: wave(),
      adapter: hook.adapter,
      handoffClient: hook.handoffClient,
      context: {
        workspaceId: workspace.id,
        workspaceKey: workspace.key,
        workspaceRoot: dir,
        runId: "run-failure",
        itemId: "item-failure",
        projectId: "project-1",
        projectRef: "proj_1",
        parentBranchRef: "br_parent",
        dbMode: "branching",
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.failedStep, "handoff")
    assert.equal(result.failureCause, "Provider rejected keys request")
  } finally {
    if (previousSecretStorePath == null) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStorePath
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

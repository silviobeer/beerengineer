import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSupabaseCapability, SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/core/capabilities/supabaseCapability.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-preflight-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("PROJ-4 PRD-1 US-5: preflight reports both missing local prerequisites", async () => {
  const paths = tempStore()
  try {
    const capability = createSupabaseCapability({ secretStore: { storePath: paths.storePath } })
    assert.deepEqual(await capability.ports.preflight!(), {
      capabilityId: "supabase",
      status: "not_configured",
      reason: "management token missing and project ref missing",
    })
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-1 US-5: preflight names only the missing project ref when token exists", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const capability = createSupabaseCapability({ secretStore: { storePath: paths.storePath } })
    const result = await capability.ports.preflight!()

    assert.equal(result.status, "not_configured")
    assert.equal(result.reason, "project ref missing")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-1 US-5: preflight does not call adapter when locally not configured", async () => {
  const paths = tempStore()
  try {
    const capability = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      adapter: {
        provisionBranch: async () => { throw new Error("adapter must not be called") },
        pollBranchStatus: async () => { throw new Error("adapter must not be called") },
        validateBranch: async () => { throw new Error("adapter must not be called") },
        destroyBranch: async () => { throw new Error("adapter must not be called") },
        migrateProduction: async () => { throw new Error("adapter must not be called") },
        reconcile: async () => { throw new Error("adapter must not be called") },
      },
    })

    assert.equal((await capability.ports.preflight!()).status, "not_configured")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-2 US-2: preflight probes branching support and returns quota context", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const capability = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_1" },
      managementClient: {
        getProject: async () => ({ id: "1", ref: "proj_1", plan: "team", branchingEnabled: true, branchQuotaLimit: 8 }),
        listBranches: async () => [{ id: "b1", ref: "br_1" }, { id: "b2", ref: "br_2" }],
      },
    })
    assert.deepEqual(await capability.ports.preflight!(), {
      capabilityId: "supabase",
      status: "ready",
      context: {
        projectRef: "proj_1",
        plan: "team",
        branchingEnabled: true,
        branchQuotaUsage: 2,
        branchQuotaLimit: 8,
      },
    })
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-2 US-2: preflight surfaces plan and token-scope failures", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const noBranching = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_1" },
      managementClient: {
        getProject: async () => ({ id: "1", ref: "proj_1", branchingEnabled: false }),
        listBranches: async () => [],
      },
    })
    assert.equal((await noBranching.ports.preflight!()).status, "failed")

    const insufficientScope = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_1" },
      managementClient: {
        getProject: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }) },
        listBranches: async () => [],
      },
    })
    const result = await insufficientScope.ports.preflight!()
    assert.equal(result.status, "failed")
    assert.match(result.reason, /Forbidden/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

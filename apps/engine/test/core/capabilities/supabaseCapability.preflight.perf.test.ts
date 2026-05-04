import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSupabaseCapability, SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/core/capabilities/supabaseCapability.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-perf-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("PROJ-4 BUG-025: preflight calls getProject and listBranches in parallel", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const callOrder: string[] = []
    let getProjectStartedBeforeBranchesStarted = false
    let listBranchesStarted = false
    const capability = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_1" },
      managementClient: {
        getProject: async () => {
          callOrder.push("getProject:start")
          // Yield to the event loop to allow listBranches to also start.
          await new Promise(resolve => setImmediate(resolve))
          callOrder.push("getProject:end")
          return { id: "1", ref: "proj_1", plan: "team", branchingEnabled: true, branchQuotaLimit: 8 }
        },
        listBranches: async () => {
          callOrder.push("listBranches:start")
          if (callOrder.includes("getProject:start") && !callOrder.includes("getProject:end")) {
            getProjectStartedBeforeBranchesStarted = true
          }
          listBranchesStarted = true
          await new Promise(resolve => setImmediate(resolve))
          callOrder.push("listBranches:end")
          return [{ id: "b1", ref: "br_1" }]
        },
      },
    })
    const result = await capability.ports.preflight!()
    assert.equal(result.status, "ready")
    // Both started before either finished -> ran concurrently via Promise.all.
    assert.equal(getProjectStartedBeforeBranchesStarted, true,
      `expected listBranches to start before getProject finished; order: ${callOrder.join(" -> ")}`)
    assert.equal(listBranchesStarted, true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 BUG-025: preflight surfaces getProject failure even when listBranches succeeds", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const capability = createSupabaseCapability({
      secretStore: { storePath: paths.storePath },
      workspace: { projectRef: "proj_1" },
      managementClient: {
        getProject: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }) },
        listBranches: async () => [],
      },
    })
    const result = await capability.ports.preflight!()
    assert.equal(result.status, "failed")
    assert.match(result.reason, /Forbidden/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

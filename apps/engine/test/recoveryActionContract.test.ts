import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  mutateRunRecoveryActionInProcess,
  type RunRecoveryActionRequest,
} from "../src/core/runService.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { projectStageLogRow } from "../src/core/messagingProjection.js"

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, unknown>
  }
}

function withRepos<T>(fn: (repos: Repos) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "be2-recovery-action-contract-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    return fn(repos)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function createRunFixture(repos: Repos) {
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Recovery Item", description: "desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api", status: "blocked" })
  return { workspace, item, run }
}

function mutate(repos: Repos, runId: string, request: RunRecoveryActionRequest) {
  return mutateRunRecoveryActionInProcess(repos, { runId, ...request })
}

function loadOpenApi(): OpenApiDocument {
  return JSON.parse(readFileSync(new URL("../src/api/openapi.json", import.meta.url), "utf8")) as OpenApiDocument
}

test("SETUP-1 recovery service applies implemented clear actions through the authoritative seam", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)
    repos.setRunRecoveryPayloadJson(run.id, "{\"status\":\"blocked\"}")
    repos.setRunRecoverySupabaseBranchRef(run.id, "br_demo")
    repos.setRunRecoverySupabaseLifecycleState(run.id, "retained")

    const result = mutate(repos, run.id, { action: "clear_recovery_payload" })

    assert.deepEqual(result, {
      ok: true,
      runId: run.id,
      action: "clear_recovery_payload",
      outcome: "accepted",
      latestState: {
        recoveryPayloadJson: null,
        supabaseBranchRef: "br_demo",
        supabaseBranchLifecycleState: "retained",
      },
    })

    const recoveryLog = repos.listLogsForRun(run.id).find(log => log.event_type === "run_recovery_action")
    assert.ok(recoveryLog, "expected accepted recovery action log")
    const projected = projectStageLogRow(recoveryLog!)
    assert.equal(projected?.type, "run_recovery_action")
    assert.equal(projected?.payload.action, "clear_recovery_payload")
    assert.equal(projected?.payload.outcome, "accepted")
  })
})

test("SETUP-1 clear actions return a canonical HTTP-200 noop when the targeted field is already clear", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)

    const result = mutate(repos, run.id, { action: "clear_supabase_branch_ref" })

    assert.deepEqual(result, {
      ok: true,
      runId: run.id,
      action: "clear_supabase_branch_ref",
      outcome: "noop",
      reason: "already_clear",
      latestState: {
        recoveryPayloadJson: null,
        supabaseBranchRef: null,
        supabaseBranchLifecycleState: null,
      },
    })

    const recoveryLog = repos.listLogsForRun(run.id).find(log => log.event_type === "run_recovery_action")
    assert.ok(recoveryLog, "expected noop recovery action log")
    const projected = projectStageLogRow(recoveryLog!)
    assert.equal(projected?.payload.outcome, "noop")
    assert.equal(projected?.payload.reason, "already_clear")
  })
})

test("SETUP-1 named recovery and skip actions stay on the canonical route with specific rejection vocabulary until later waves implement them", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)

    const result = mutate(repos, run.id, { action: "skip_current_stage" })

    assert.deepEqual(result, {
      ok: false,
      status: 501,
      error: "recovery_action_reserved",
      code: "not_implemented",
      action: "skip_current_stage",
      reason: "action_not_implemented",
      message: "Named recovery actions are reserved on POST /runs/:id/recovery and will be wired by later stories.",
    })
  })
})

test("SETUP-1 runs route delegates recovery mutations to the authoritative service seam instead of mutating repos directly", () => {
  const runs = readFileSync(new URL("../src/api/routes/runs.ts", import.meta.url), "utf8")
  const start = runs.indexOf("export async function handleMutateRecovery")
  const end = runs.indexOf("/**\n * Resume a blocked run.", start)
  const handler = runs.slice(start, end)

  assert.match(handler, /mutateRunRecoveryActionInProcess/)
  assert.doesNotMatch(handler, /setRunRecoveryPayloadJson|setRunRecoverySupabaseBranchRef|setRunRecoverySupabaseLifecycleState/)
})

test("SETUP-1 OpenAPI and prose reserve the single recovery-action family and its accepted/noop/rejection vocabulary", () => {
  const document = loadOpenApi()
  const schemas = document.components?.schemas ?? {}
  const request = schemas.RecoveryActionRequest as {
    properties?: {
      action?: {
        enum?: string[]
      }
    }
  }
  const result = schemas.RecoveryActionResult as {
    oneOf?: Array<{
      properties?: Record<string, { enum?: string[] }>
      required?: string[]
    }>
  }
  const rejection = schemas.RecoveryActionRejection as {
    properties?: Record<string, { enum?: string[] }>
  }
  const docs = readFileSync(new URL("../../../docs/api-contract.md", import.meta.url), "utf8")

  assert.deepEqual(request.properties?.action?.enum, [
    "resume",
    "replan",
    "retry_supabase_readiness",
    "skip_current_stage",
    "clear_recovery_payload",
    "clear_supabase_branch_ref",
    "clear_supabase_branch_lifecycle_state",
  ])

  const outcomes = result.oneOf?.flatMap(option => option.properties?.outcome?.enum ?? []) ?? []
  assert.ok(outcomes.includes("accepted"))
  assert.ok(outcomes.includes("noop"))
  const rejectionReasons = rejection.properties?.reason?.enum ?? []
  assert.ok(rejectionReasons.includes("action_required"))
  assert.ok(rejectionReasons.includes("unsupported_action"))
  assert.ok(rejectionReasons.includes("action_not_implemented"))

  assert.match(docs, /Canonical recovery mutation surface for named recovery, skip, and narrow clear actions\./)
  assert.match(docs, /Implemented clear actions return `outcome: "accepted"` when they changed latest state and `outcome: "noop"` with `reason: "already_clear"` when the targeted field was already clear\./)
  assert.match(docs, /Later waves extend the same route with specific machine-readable rejection reasons instead of introducing a second mutation surface\./)
})

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../db/repositories.js"
import type { SupabaseAdapter } from "../../core/supabase/types.js"
import { recordSupabaseOperatorAction } from "../../core/supabase/lifecycleEvents.js"
import { json, readJson } from "../http.js"

export async function handleRetryValidation(input: {
  repos: Repos
  adapter: Pick<SupabaseAdapter, "validateBranch">
  req: IncomingMessage
  res: ServerResponse
  branchRef: string
}): Promise<void> {
  const body = await readJson(input.req) as Record<string, unknown>
  const runId = typeof body.runId === "string" ? body.runId : ""
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
  if (!runId || !workspaceId || !input.branchRef) {
    json(input.res, 400, { ok: false, error: "retry_validation_context_required", message: "runId, workspaceId, and branchRef are required" })
    return
  }

  const operatorId = typeof body.workspaceLocalOperatorId === "string" ? body.workspaceLocalOperatorId : "local-operator"
  const reject = (reason: string, opts: { runExists: boolean }): void => {
    // Audit-log only when the run exists; appending to a non-existent run
    // violates the stage_logs FK and would 500 the request.
    if (opts.runExists) {
      recordSupabaseOperatorAction({
        repos: input.repos,
        runId,
        workspaceId,
        branchRef: input.branchRef,
        action: "retry_validation",
        workspaceLocalOperatorId: operatorId,
        outcome: "rejected",
        reason,
      })
    }
    json(input.res, 403, { ok: false, error: "supabase_target_mismatch", message: reason })
  }

  const workspace = input.repos.getWorkspace(workspaceId)
  const run = input.repos.getRun(runId)
  const runExists = run !== undefined

  if (!workspace || !workspace.supabase_project_ref) {
    reject("workspace_supabase_not_configured", { runExists })
    return
  }
  if (!run) {
    reject("run_not_found", { runExists: false })
    return
  }
  if (run.workspace_id !== workspaceId) {
    reject("run_workspace_mismatch", { runExists: true })
    return
  }
  if (!run.supabase_branch_ref) {
    reject("run_branch_not_provisioned", { runExists: true })
    return
  }
  if (run.supabase_branch_ref !== input.branchRef) {
    reject("branch_ref_mismatch", { runExists: true })
    return
  }
  if (typeof body.projectRef === "string" && body.projectRef !== workspace.supabase_project_ref) {
    reject("project_ref_mismatch", { runExists: true })
    return
  }

  // Server-derived values; ignore body.projectRef and body.workspaceRoot to
  // prevent cross-project SQL execution via attacker-supplied targets.
  const projectRef = workspace.supabase_project_ref
  const branchRef = run.supabase_branch_ref
  const workspaceRoot = workspace.root_path ?? undefined

  const result = await input.adapter.validateBranch({
    runId,
    workspaceId,
    projectRef,
    branchRef,
    workspaceRoot,
  })

  recordSupabaseOperatorAction({
    repos: input.repos,
    runId,
    workspaceId,
    branchRef,
    action: "retry_validation",
    workspaceLocalOperatorId: operatorId,
    outcome: "accepted",
  })

  json(input.res, result.ok ? 200 : 409, result)
}

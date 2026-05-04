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
  const projectRef = typeof body.projectRef === "string" ? body.projectRef : ""
  const workspaceRoot = typeof body.workspaceRoot === "string" ? body.workspaceRoot : undefined
  if (!runId || !workspaceId || !projectRef || !input.branchRef) {
    json(input.res, 400, { ok: false, error: "retry_validation_context_required", message: "runId, workspaceId, projectRef, and branchRef are required" })
    return
  }
  recordSupabaseOperatorAction({
    repos: input.repos,
    runId,
    workspaceId,
    branchRef: input.branchRef,
    action: "retry_validation",
    workspaceLocalOperatorId: typeof body.workspaceLocalOperatorId === "string" ? body.workspaceLocalOperatorId : "local-operator",
  })
  const result = await input.adapter.validateBranch({ runId, workspaceId, projectRef, branchRef: input.branchRef, workspaceRoot })
  json(input.res, result.ok ? 200 : 409, result)
}

import type { IncomingMessage, ServerResponse } from "node:http"
import type { ItemActionsService } from "../../core/itemActions.js"
import { isItemAction } from "../../core/itemActions.js"
import { json, readJson } from "../http.js"

export async function handleItemAction(
  itemActions: ItemActionsService,
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string,
): Promise<void> {
  const body = (await readJson(req)) as {
    action?: unknown
    resume?: { summary?: string; branch?: string; commitSha?: string; reviewNotes?: string }
  }
  if (!isItemAction(body.action)) {
    return json(res, 400, {
      error: "action is required",
      valid: ["start_brainstorm", "promote_to_requirements", "start_implementation", "resume_run", "mark_done"],
    })
  }

  const resumeInput = body.resume?.summary
    ? { resume: body.resume as { summary: string; branch?: string; commitSha?: string; reviewNotes?: string } }
    : undefined
  const result = await itemActions.perform(itemId, body.action, resumeInput)
  if (!result.ok) {
    if (result.status === 404) return json(res, 404, { error: result.error })
    if (result.status === 422) return json(res, 422, { error: result.error, action: result.action })
    return json(res, 409, { error: result.error, current: result.current, action: result.action })
  }

  // `kind: "needs_spawn"` tells the UI to spawn the CLI. Workflows never
  // run inside the engine HTTP process — this endpoint only records intent
  // (column change for start-run, remediation row for resume).
  const payload: Record<string, unknown> = {
    kind: result.kind,
    itemId: result.itemId,
    column: result.column,
    phaseStatus: result.phaseStatus,
  }
  if (result.kind === "needs_spawn") {
    payload.action = result.action
    payload.needsSpawn = true
    if (result.runId) payload.runId = result.runId
    if (result.remediationId) payload.remediationId = result.remediationId
  }
  json(res, 200, payload)
}

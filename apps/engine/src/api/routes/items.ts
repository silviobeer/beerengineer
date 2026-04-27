import type { IncomingMessage, ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Repos } from "../../db/repositories.js"
import { isItemAction, lookupTransition, type ItemActionsService } from "../../core/itemActions.js"
import { latestCompletedRunForItem } from "../../core/itemWorkspace.js"
import { startRunForItem } from "../../core/runService.js"
import { layout } from "../../core/workspaceLayout.js"
import { resolveWorkflowContextForRun } from "../../core/workflowContextResolver.js"
import { json, readJson } from "../http.js"
import type { DesignArtifact, WireframeArtifact } from "../../types.js"

export function handleListItems(repos: Repos, url: URL, res: ServerResponse): void {
  const workspaceKey = url.searchParams.get("workspace")?.trim() ?? ""
  const status = url.searchParams.get("status")?.trim() ?? ""
  const column = url.searchParams.get("column")?.trim() ?? ""
  const limitRaw = Number(url.searchParams.get("limit") ?? "")
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined

  const workspaceId = workspaceKey ? repos.getWorkspaceByKey(workspaceKey)?.id : undefined
  let items = workspaceId
    ? repos.listItemsForWorkspace(workspaceId)
    : repos.listWorkspaces().flatMap(workspace => repos.listItemsForWorkspace(workspace.id))

  if (column) items = items.filter(item => item.current_column === column)
  if (status) items = items.filter(item => item.phase_status === status)
  if (limit !== undefined) items = items.slice(0, limit)

  json(res, 200, { items })
}

export function handleGetItem(repos: Repos, res: ServerResponse, itemId: string): void {
  const item = repos.getItem(itemId)
  if (!item) return json(res, 404, { error: "item_not_found", code: "not_found" })
  json(res, 200, item)
}

export function handleGetItemWireframes(repos: Repos, res: ServerResponse, itemId: string): void {
  const item = repos.getItem(itemId)
  if (!item) return json(res, 404, { error: "item_not_found", code: "not_found" })
  const run = latestCompletedRunForItem(repos, item.id)
  if (!run) return json(res, 404, { error: "no_completed_run", code: "not_found" })
  const ctx = resolveWorkflowContextForRun(repos, run)
  if (!ctx) return json(res, 404, { error: "artefact_root_unreachable", code: "not_found" })
  const base = layout.stageArtifactsDir(ctx, "visual-companion")
  const dataPath = join(base, "wireframes.json")
  if (!existsSync(dataPath)) return json(res, 404, { error: "no_design_prep", code: "not_found" })
  const artifact = JSON.parse(readFileSync(dataPath, "utf8")) as WireframeArtifact
  json(res, 200, {
    itemId: item.id,
    runId: run.id,
    artifact,
    screenMapPath: join(base, "screen-map.html"),
    screenMapUrl: `/runs/${run.id}/artifacts/stages/visual-companion/artifacts/screen-map.html`,
    screens: artifact.screens.map(screen => ({
      id: screen.id,
      name: screen.name,
      path: join(base, `${screen.id}.html`),
      url: `/runs/${run.id}/artifacts/stages/visual-companion/artifacts/${screen.id}.html`,
    })),
  })
}

export function handleGetItemDesign(repos: Repos, res: ServerResponse, itemId: string): void {
  const item = repos.getItem(itemId)
  if (!item) return json(res, 404, { error: "item_not_found", code: "not_found" })
  const run = latestCompletedRunForItem(repos, item.id)
  if (!run) return json(res, 404, { error: "no_completed_run", code: "not_found" })
  const ctx = resolveWorkflowContextForRun(repos, run)
  if (!ctx) return json(res, 404, { error: "artefact_root_unreachable", code: "not_found" })
  const base = layout.stageArtifactsDir(ctx, "frontend-design")
  const dataPath = join(base, "design.json")
  if (!existsSync(dataPath)) return json(res, 404, { error: "no_design_prep", code: "not_found" })
  const artifact = JSON.parse(readFileSync(dataPath, "utf8")) as DesignArtifact
  json(res, 200, {
    itemId: item.id,
    runId: run.id,
    artifact,
    previewPath: join(base, "design-preview.html"),
    previewUrl: `/runs/${run.id}/artifacts/stages/frontend-design/artifacts/design-preview.html`,
  })
}

/**
 * `POST /items/:id/actions/:action` — explicit action routes.
 *
 *   start_brainstorm     → starts a new run in-process.
 *   start_implementation → starts a new run after seeding brainstorm artifacts.
 *   rerun_design_prep    → starts a new run after seeding brainstorm artifacts and resumes at visual-companion.
 *   promote_to_requirements | mark_done → pure column/phase transitions.
 *   resume_run is addressed by `POST /runs/:id/resume` — items don't resume,
 *     runs do. Keeping the resume surface on the run scope avoids duplicating
 *     remediation semantics across two endpoints.
 *
 */
export async function handleItemActionNamed(
  itemActions: ItemActionsService,
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string,
  action: string,
): Promise<void> {
  if (!isItemAction(action) || action === "resume_run") {
    return json(res, 400, {
      error: "bad_request",
      code: "bad_request",
      valid: [
        "start_brainstorm",
        "start_visual_companion",
        "start_frontend_design",
        "promote_to_requirements",
        "start_implementation",
        "rerun_design_prep",
        "mark_done",
      ],
    })
  }
  // Consume the body even though these actions currently have no request
  // fields; that keeps the route future-proof for action-specific payloads.
  await readJson(req).catch(() => ({}))

  if (
    action === "start_brainstorm" ||
    action === "start_visual_companion" ||
    action === "start_frontend_design" ||
    action === "start_implementation" ||
    action === "rerun_design_prep"
  ) {
    const item = repos.getItem(itemId)
    if (!item) return json(res, 404, { error: "item_not_found", code: "not_found" })
    const transition = lookupTransition(action, item.current_column, item.phase_status)
    if (transition.kind !== "start-run") {
      return json(res, 409, {
        error: "invalid_transition",
        code: "invalid_transition",
        current: { column: item.current_column, phaseStatus: item.phase_status },
        action,
      })
    }
    const result = startRunForItem(repos, { itemId, action })
    if (!result.ok) return json(res, result.status, { error: result.error, action })
    // Move the board column immediately so clients see the transition before
    // the workflow emits its first stage update.
    repos.setItemColumn(itemId, transition.column, "running")
    return json(res, 200, {
      kind: "started",
      itemId,
      runId: result.runId,
      action,
      column: transition.column,
      phaseStatus: "running",
    })
  }

  // Pure state transitions use the shared service.
  const result = await itemActions.perform(itemId, action)
  if (!result.ok) {
    if (result.status === 404) return json(res, 404, { error: result.error, code: "not_found" })
    if (result.status === 422) return json(res, 422, { error: result.error, action: result.action })
    return json(res, 409, {
      error: result.error,
      code: result.error,
      current: result.current,
      action: result.action,
    })
  }
  return json(res, 200, {
    kind: result.kind,
    itemId: result.itemId,
    column: result.column,
    phaseStatus: result.phaseStatus,
  })
}

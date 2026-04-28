import type { IncomingMessage, ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Repos } from "../../db/repositories.js"
import { isPortListening, readManagedPreviewPid, resolvePreviewLaunchSpec, startPreviewServer, stopPreviewServer } from "../../core/previewLauncher.js"
import { resolveItemPreviewContext } from "../../core/itemPreview.js"
import { isItemAction, lookupTransition, type ItemActionsService } from "../../core/itemActions.js"
import { latestCompletedRunForItem } from "../../core/itemWorkspace.js"
import { resumeRunInProcess, startRunForItem } from "../../core/runService.js"
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

export function handleGetItemPreview(repos: Repos, res: ServerResponse, itemId: string): void {
  void (async () => {
    const context = resolveItemPreviewContext(repos, itemId)
    if (!context.ok) return json(res, 404, context)
    const launch = resolvePreviewLaunchSpec(context.worktreePath)
    const running = await isPortListening(context.previewHost, context.previewPort)
    const pid = readManagedPreviewPid(context.worktreePath)
    json(res, 200, {
      ...context,
      running,
      managed: pid != null,
      pid,
      launch: launch
        ? {
            command: launch.command,
            cwd: launch.cwd,
            source: launch.source,
          }
        : null,
    })
  })().catch(err => json(res, 500, { error: (err as Error).message, code: "preview_lookup_failed" }))
}

export async function handleStartItemPreview(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string,
): Promise<void> {
  await readJson(req).catch(() => ({}))
  const context = resolveItemPreviewContext(repos, itemId)
  if (!context.ok) return json(res, 404, context)
  try {
    const started = await startPreviewServer(context)
    return json(res, 200, {
      ...context,
      running: true,
      status: started.status,
      logPath: started.logPath,
      managed: started.pid != null,
      pid: started.pid,
      launch: {
        command: started.launch.command,
        cwd: started.launch.cwd,
        source: started.launch.source,
      },
    })
  } catch (error) {
    return json(res, 409, {
      error: (error as Error).message,
      code: (error as Error).message,
    })
  }
}

export async function handleStopItemPreview(
  repos: Repos,
  req: IncomingMessage,
  res: ServerResponse,
  itemId: string,
): Promise<void> {
  await readJson(req).catch(() => ({}))
  const context = resolveItemPreviewContext(repos, itemId)
  if (!context.ok) return json(res, 404, context)
  try {
    const stopped = await stopPreviewServer(context)
    return json(res, 200, {
      ...context,
      running: false,
      managed: false,
      status: stopped.status,
      logPath: stopped.logPath,
      pid: null,
      launch: null,
    })
  } catch (error) {
    return json(res, 409, {
      error: (error as Error).message,
      code: (error as Error).message,
    })
  }
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
        "promote_to_base",
        "cancel_promotion",
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
  if (result.kind === "resume_run") {
    const resumed = await resumeRunInProcess(repos, {
      runId: result.runId,
      summary: result.summary,
      branch: result.branch,
      reviewNotes: result.reviewNotes,
    })
    if (!resumed.ok) return json(res, resumed.status, { error: resumed.error, code: resumed.error })
  }
  return json(res, 200, {
    kind: result.kind,
    itemId: result.itemId,
    column: result.column,
    phaseStatus: result.phaseStatus,
  })
}

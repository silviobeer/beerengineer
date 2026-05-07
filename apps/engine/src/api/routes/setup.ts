import type { IncomingMessage, ServerResponse } from "node:http"
import { rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { initializeAppState } from "../../setup/appState.js"
import { getAppConfigView } from "../../setup/appConfigView.js"
import { patchAppConfig } from "../../setup/appConfigPatch.js"
import { generateSetupReport, runSetupRecheck } from "../../setup/doctor.js"
import { applySecretAction } from "../../setup/secretActions.js"
import { readSecretMetadata } from "../../setup/secretMetadata.js"
import { runSecretTest } from "../../setup/secretTests.js"
import { KNOWN_GROUP_IDS, resolveOverrides } from "../../setup/config.js"
import { SupabaseManagementClient } from "../../core/supabase/managementClient.js"
import { createSupabaseAdapter, recreatePersistentTestBranch } from "../../core/supabase/adapter.js"
import { explicitDestroyBranch } from "../../core/supabase/cleanupOrchestrator.js"
import type { SupabaseAdapter } from "../../core/supabase/types.js"
import { connectSupabaseProject } from "../../setup/supabaseSetup.js"
import { rotateSupabaseManagementToken, type SupabaseTokenRotationSurface } from "../../setup/secretActions.supabaseRotate.js"
import { patchSupabaseSettings } from "../../setup/supabaseSettings.js"
import { readActiveSecretValue } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { Repos } from "../../db/repositories.js"
import { json, readJson } from "../http.js"

/**
 * BUG-PROJ4-QA-006: only IDs that consist solely of alphanumerics, dots,
 * underscores and dashes are safe to interpolate into filesystem paths.
 * UUIDs (the normal case) satisfy this constraint. Path-traversal sequences
 * such as `../` are rejected before any path is composed.
 */
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/

export async function handleSetupStatus(url: URL, res: ServerResponse): Promise<void> {
  const group = url.searchParams.get("group") ?? undefined
  if (group && !(KNOWN_GROUP_IDS as readonly string[]).includes(group)) {
    json(res, 400, { error: "unknown_group", group })
    return
  }
  const report = await generateSetupReport({ group })
  json(res, 200, report)
}

export async function handleSetupInit(res: ServerResponse): Promise<void> {
  const result = initializeAppState()
  json(res, result.ok ? 200 : 409, result)
}

export async function handleSetupConfig(repos: Repos, res: ServerResponse): Promise<void> {
  json(res, 200, getAppConfigView({}, { repos }))
}

export async function handleSetupConfigPatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req)
  const result = patchAppConfig(resolveOverrides(), body)
  if (result.rejected.some(entry => entry.error === "setup_config_missing")) {
    json(res, 409, result)
    return
  }
  json(res, result.rejected.length > 0 ? 207 : 200, result)
}

export async function handleSetupRecheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req)
  let group: string | undefined
  if (body && typeof body === "object" && typeof (body as { group?: unknown }).group === "string") {
    group = (body as { group: string }).group
  }
  const result = await runSetupRecheck({ group })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSupabaseConnect(repos: Repos, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req) as { workspaceId?: unknown; token?: unknown; projectRef?: unknown }
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : ""
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  const projectRef = typeof body?.projectRef === "string" ? body.projectRef.trim() : ""
  if (!workspaceId || !token || !projectRef) {
    json(res, 400, { ok: false, error: "invalid_supabase_connect_request", message: "workspaceId, token, and projectRef are required" })
    return
  }
  const result = await connectSupabaseProject({
    repos,
    workspaceId,
    token,
    projectRef,
    client: new SupabaseManagementClient({ token }),
  })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSupabaseRotate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req) as { token?: unknown; surface?: unknown }
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  const surface = parseSurface(body?.surface)
  if (!surface) {
    json(res, 400, { ok: false, error: "invalid_surface", message: "surface is required" })
    return
  }
  const result = await rotateSupabaseManagementToken({
    token,
    surface,
    client: new SupabaseManagementClient({ token }),
  })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSupabaseDisconnect(repos: Repos, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req) as { workspaceId?: unknown }
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : ""
  if (!workspaceId) {
    json(res, 400, { ok: false, error: "workspace_required", message: "workspaceId is required" })
    return
  }
  const workspace = repos.disconnectWorkspaceSupabase(workspaceId)
  json(res, workspace ? 200 : 404, workspace ? { ok: true } : { ok: false, error: "workspace_not_found", message: "Workspace not found" })
}

export async function handleSupabaseSettingsPatch(repos: Repos, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = patchSupabaseSettings(repos, await readJson(req) as Record<string, unknown>)
  json(res, result.ok ? 200 : result.error === "settings_changed" ? 409 : 400, result)
}

// ---------------------------------------------------------------------------
// BUG-PROJ4-QA-006 fix: server-side handoff path derivation
// ---------------------------------------------------------------------------
//
// `body.handoffPath` is no longer read or forwarded.  The handoff directory
// is derived entirely server-side from the workspace root and the run ID.
// The derived path is validated for containment within the canonical handoff
// root before any filesystem operation is performed.

export type DestroyBranchTarget =
  | {
      ok: true
      workspaceId: string
      projectRef: string
      branchRef: string
      branchName: string
      confirmedName: string
      runId: string
      workspaceRoot: string
    }
  | { ok: false; status: number; error: string; message: string }

/**
 * Resolve and validate all inputs needed to destroy a Supabase branch.
 * All values are sourced from the database — the request body is used only
 * as an identifier lookup key, never as a trusted target.
 */
export function resolveDestroyBranchTarget(repos: Repos, body: Record<string, unknown>): DestroyBranchTarget {
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
  const runId = typeof body.runId === "string" ? body.runId : ""
  const branchRef = typeof body.branchRef === "string" ? body.branchRef : ""
  const confirmedName = typeof body.confirmedName === "string" ? body.confirmedName : ""
  if (!workspaceId || !runId || !branchRef || !confirmedName) {
    return { ok: false, status: 400, error: "destroy_context_required", message: "workspaceId, runId, branchRef, and confirmedName are required" }
  }
  // Validate the runId against the safe-ID pattern before it is used in any
  // path composition (defense-in-depth even if createRun normally mints UUIDs).
  if (!SAFE_ID_RE.test(runId)) {
    return { ok: false, status: 400, error: "destroy_context_required", message: "runId contains invalid characters" }
  }
  const workspace = repos.getWorkspace(workspaceId)
  const run = repos.getRun(runId)
  if (!workspace || !workspace.supabase_project_ref || !workspace.root_path || !run || run.workspace_id !== workspaceId) {
    return { ok: false, status: 404, error: "destroy_target_not_found", message: "Stored Supabase branch target was not found for this workspace and run" }
  }
  if (!run.supabase_branch_ref || run.supabase_branch_ref !== branchRef) {
    return { ok: false, status: 409, error: "destroy_branch_mismatch", message: "Branch ref does not match the stored run branch" }
  }
  if (workspace.supabase_persistent_test_branch_ref && branchRef === workspace.supabase_persistent_test_branch_ref) {
    return { ok: false, status: 409, error: "persistent_branch_destroy_rejected", message: "Persistent test branches must be recreated from settings, not destroyed from run status" }
  }
  const branchName = run.supabase_branch_name ?? run.supabase_branch_ref
  if (confirmedName !== branchName) {
    return { ok: false, status: 409, error: "confirmation_mismatch", message: "Branch name confirmation does not match" }
  }
  return {
    ok: true,
    workspaceId,
    projectRef: workspace.supabase_project_ref,
    branchRef,
    branchName,
    confirmedName,
    runId,
    workspaceRoot: workspace.root_path,
  }
}

/**
 * Derive the canonical handoff directory for a run and assert it is contained
 * within the workspace's handoff root.  Returns the absolute directory path
 * on success, or an error string on containment failure.
 *
 * This is the ONLY place a handoff path is constructed for the destroy route.
 * The request body's `handoffPath` field is never read.
 */
function deriveHandoffDir(workspaceRoot: string, runId: string): { ok: true; dir: string } | { ok: false; reason: string } {
  const canonicalRoot = resolve(join(workspaceRoot, ".beerengineer", "handoff", "supabase"))
  const dir = resolve(join(canonicalRoot, runId))
  if (!dir.startsWith(canonicalRoot + "/") && dir !== canonicalRoot) {
    return { ok: false, reason: "derived handoff path escapes workspace handoff root" }
  }
  return { ok: true, dir }
}

/**
 * Delete the handoff directory for a run.  Silently ignores ENOENT (already
 * cleaned up or never created).  All other errors propagate.
 */
async function deleteHandoffDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

export async function handleSupabaseDestroyBranch(input: {
  repos: Repos
  adapter?: Pick<SupabaseAdapter, "destroyBranch">
  req: IncomingMessage
  res: ServerResponse
}): Promise<void> {
  const { repos, req, res } = input
  const body = await readJson(req) as Record<string, unknown>

  const target = resolveDestroyBranchTarget(repos, body)
  if (!target.ok) {
    json(res, target.status, { ok: false, error: target.error, message: target.message })
    return
  }

  const handoffDirResult = deriveHandoffDir(target.workspaceRoot, target.runId)
  if (!handoffDirResult.ok) {
    json(res, 400, { ok: false, error: "destroy_context_required", message: handoffDirResult.reason })
    return
  }

  let adapter = input.adapter
  if (!adapter) {
    const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
    if (!token) {
      json(res, 400, { ok: false, error: "destroy_context_required", message: "Supabase management token is required" })
      return
    }
    adapter = createSupabaseAdapter({ repos, client: new SupabaseManagementClient({ token }) })
  }

  const result = await explicitDestroyBranch({
    repos,
    adapter,
    workspaceId: target.workspaceId,
    projectRef: target.projectRef,
    branchRef: target.branchRef,
    branchName: target.branchName,
    confirmedName: target.confirmedName,
    runId: target.runId,
  })
  if (result.ok) {
    await deleteHandoffDir(handoffDirResult.dir)
  }
  json(res, result.ok ? 200 : 409, result)
}

export async function handleSupabaseRecreate(repos: Repos, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req) as Record<string, unknown>
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
  const confirmedName = typeof body.confirmedName === "string" ? body.confirmedName : ""
  const workspace = workspaceId ? repos.getWorkspace(workspaceId) : undefined
  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  if (!workspace?.supabase_project_ref || !workspace.supabase_persistent_test_branch_ref || !workspace.root_path || !token) {
    json(res, 400, { ok: false, error: "recreate_context_required", message: "workspace, persistent branch, token, and root path are required" })
    return
  }
  const branchName = workspace.supabase_persistent_test_branch_name ?? workspace.supabase_persistent_test_branch_ref
  if (confirmedName !== branchName) {
    json(res, 409, { ok: false, error: "confirmation_mismatch", message: "Branch name confirmation does not match" })
    return
  }
  const adapter = createSupabaseAdapter({ repos, client: new SupabaseManagementClient({ token }) })
  const result = await recreatePersistentTestBranch({
    repos,
    adapter,
    workspaceId,
    projectRef: workspace.supabase_project_ref,
    branchRef: workspace.supabase_persistent_test_branch_ref,
    branchName,
    workspaceRoot: workspace.root_path,
  })
  json(res, result.ok ? 200 : 409, result)
}

export async function handleSecretAction(req: IncomingMessage, res: ServerResponse, ref: string): Promise<void> {
  const body = await readJson(req)
  const decoded = parseSecretRef(ref)
  if (!decoded) {
    json(res, 400, { error: "invalid_secret_ref" })
    return
  }
  if (body && typeof body === "object" && (body as { action?: unknown }).action === "test") {
    const result = await runSecretTest(decoded)
    const statusCode = result.ok ? 200 : secretTestFailureStatus(result.status)
    json(res, statusCode, result)
    return
  }
  const result = applySecretAction(decoded, body)
  json(res, result.ok ? 200 : 400, result)
}

export async function handleSecretMetadata(res: ServerResponse, ref: string): Promise<void> {
  const decoded = parseSecretRef(ref)
  if (!decoded) {
    json(res, 400, { error: "invalid_secret_ref" })
    return
  }
  json(res, 200, readSecretMetadata(decoded))
}

function parseSecretRef(raw: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const trimmed = decoded.trim()
  if (!trimmed || trimmed.includes("\0")) return null
  return trimmed
}

function parseSurface(value: unknown): SupabaseTokenRotationSurface | null {
  return value === "cli" || value === "ui" || value === "setup-cli" || value === "setup-ui" ? value : null
}

function secretTestFailureStatus(status: string): number {
  if (status === "not_implemented") return 501
  return 409
}

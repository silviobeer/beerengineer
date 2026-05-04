import type { IncomingMessage, ServerResponse } from "node:http"
import { initializeAppState } from "../../setup/appState.js"
import { getAppConfigView } from "../../setup/appConfigView.js"
import { patchAppConfig } from "../../setup/appConfigPatch.js"
import { generateSetupReport, runSetupRecheck } from "../../setup/doctor.js"
import { applySecretAction } from "../../setup/secretActions.js"
import { readSecretMetadata } from "../../setup/secretMetadata.js"
import { runSecretTest } from "../../setup/secretTests.js"
import { KNOWN_GROUP_IDS } from "../../setup/config.js"
import { SupabaseManagementClient } from "../../core/supabase/managementClient.js"
import { connectSupabaseProject } from "../../setup/supabaseSetup.js"
import { rotateSupabaseManagementToken, type SupabaseTokenRotationSurface } from "../../setup/secretActions.supabaseRotate.js"
import { patchSupabaseSettings } from "../../setup/supabaseSettings.js"
import type { Repos } from "../../db/repositories.js"
import { json, readJson } from "../http.js"

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
  const result = patchAppConfig({}, body)
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

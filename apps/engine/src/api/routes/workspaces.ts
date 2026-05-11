import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../db/repositories.js"
import {
  backfillWorkspaceConfigs,
  getRegisteredWorkspace,
  listRegisteredWorkspaces,
  openWorkspace,
  previewWorkspace,
  registerWorkspace,
  removeWorkspace,
} from "../../core/workspaces.js"
import { generateSetupReport } from "../../setup/doctor.js"
import { validateHarnessProfileShape } from "../../setup/config.js"
import type { AppConfig, SetupReport } from "../../setup/types.js"
import type { HarnessProfile, RegisterWorkspaceInput } from "../../types/workspace.js"
import { json, readJson } from "../http.js"
import { readActiveSecretValue } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import { SupabaseManagementClient } from "../../core/supabase/managementClient.js"
import { createSupabasePreExecutionReadiness } from "../../core/supabase/preExecutionReadiness.js"
import { connectSupabaseProject } from "../../setup/supabaseSetup.js"
import { rotateSupabaseManagementToken } from "../../setup/secretActions.supabaseRotate.js"
import { createOrAttachPersistentTestBranch } from "../../core/supabase/persistentTestBranch.js"

function parseWorkspaceProfile(input: unknown, config: AppConfig): HarnessProfile {
  if (!input) return config.llm.defaultHarnessProfile
  return validateHarnessProfileShape(input)
}

/**
 * generateSetupReport({ allLlmGroups: true }) shells out to probe each LLM
 * CLI (version + auth) on every call. registerWorkspace needs that report
 * to validate harness availability, but running every POST /workspaces
 * through those child processes makes the API needlessly slow. 30 s is
 * short enough that a user who just installed a missing CLI can retry
 * without restarting.
 */
const SETUP_REPORT_TTL_MS = 30_000
let cachedSetupReport: { report: SetupReport; at: number } | null = null

async function getCachedSetupReport(): Promise<SetupReport> {
  if (cachedSetupReport && Date.now() - cachedSetupReport.at < SETUP_REPORT_TTL_MS) {
    return cachedSetupReport.report
  }
  const report = await generateSetupReport({ allLlmGroups: true })
  cachedSetupReport = { report, at: Date.now() }
  return report
}

export async function handleWorkspacePreview(
  repos: Repos,
  loadConfig: () => AppConfig | null,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const config = loadConfig()
  if (!config) return json(res, 409, { error: "config_unavailable" })
  const path = url.searchParams.get("path")
  if (!path) return json(res, 400, { error: "path_required" })
  const preview = await previewWorkspace(path, config, repos)
  json(res, 200, preview)
}

export async function handleWorkspaceAdd(
  repos: Repos,
  loadConfig: () => AppConfig | null,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const config = loadConfig()
  if (!config) return json(res, 409, { error: "config_unavailable" })
  const body = (await readJson(req)) as {
    path?: string
    create?: boolean
    name?: string
    key?: string
    harnessProfile?: HarnessProfile
    sonar?: RegisterWorkspaceInput["sonar"]
    git?: RegisterWorkspaceInput["git"]
  }
  if (!body.path) return json(res, 400, { error: "path_required" })
  let harnessProfile: HarnessProfile
  try {
    harnessProfile = parseWorkspaceProfile(body.harnessProfile, config)
  } catch (err) {
    return json(res, 400, { error: "invalid_harness_profile", detail: (err as Error).message })
  }
  const input: RegisterWorkspaceInput = {
    path: body.path,
    create: body.create,
    name: body.name,
    key: body.key,
    harnessProfile,
    sonar: body.sonar,
    git: body.git,
  }
  const appReport = await getCachedSetupReport()
  const result = await registerWorkspace(input, { repos, config, appReport })
  if (!result.ok) return json(res, 409, result)
  json(res, 200, result)
}

export function handleWorkspaceList(repos: Repos, res: ServerResponse): void {
  json(res, 200, { workspaces: listRegisteredWorkspaces(repos) })
}

export function handleWorkspaceGet(repos: Repos, res: ServerResponse, key: string): void {
  const workspace = getRegisteredWorkspace(repos, key)
  if (!workspace) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, workspace)
}

export async function handleWorkspaceRemove(
  repos: Repos,
  loadConfig: () => AppConfig | null,
  url: URL,
  res: ServerResponse,
  key: string,
): Promise<void> {
  const purge = url.searchParams.get("purge") === "1" || url.searchParams.get("purge") === "true"
  const config = purge ? loadConfig() : null
  if (purge && !config) return json(res, 409, { error: "config_unavailable" })
  const result = await removeWorkspace(repos, key, {
    purge,
    allowedRoots: config?.allowedRoots,
  })
  if (!result.ok) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, result)
}

export function handleWorkspaceOpen(repos: Repos, res: ServerResponse, key: string): void {
  const rootPath = openWorkspace(repos, key)
  if (!rootPath) return json(res, 404, { error: "workspace_not_found" })
  json(res, 200, { key, rootPath })
}

export async function handleWorkspaceBackfill(repos: Repos, res: ServerResponse): Promise<void> {
  const result = await backfillWorkspaceConfigs(repos)
  json(res, 200, result)
}

export async function handleWorkspaceSupabaseReadiness(repos: Repos, res: ServerResponse, key: string, runId?: string | null): Promise<void> {
  const workspace = repos.getWorkspaceByKey(key)
  if (!workspace) return json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  const readiness = await createSupabasePreExecutionReadiness({
    mode: "setup",
    workspace: {
      id: workspace.id,
      key: workspace.key,
      rootPath: workspace.root_path ?? undefined,
      projectRef: workspace.supabase_project_ref ?? undefined,
      dbMode: workspace.supabase_db_mode ?? undefined,
      persistentTestBranchRef: workspace.supabase_persistent_test_branch_ref ?? undefined,
      persistentTestBranchName: workspace.supabase_persistent_test_branch_name ?? undefined,
    },
    runId: runId ?? undefined,
    managementClient: token ? new SupabaseManagementClient({ token }) : undefined,
  })
  json(res, 200, { ok: true, readiness })
}

export async function handleWorkspaceSupabaseConnect(repos: Repos, req: IncomingMessage, res: ServerResponse, key: string): Promise<void> {
  const workspace = repos.getWorkspaceByKey(key)
  if (!workspace) return json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
  const body = await readJson(req) as { token?: unknown; projectRef?: unknown }
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  const projectRef = typeof body?.projectRef === "string" ? body.projectRef.trim() : ""
  const result = await connectSupabaseProject({
    repos,
    workspaceId: workspace.id,
    token,
    projectRef,
    client: new SupabaseManagementClient({ token }),
  })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleWorkspaceSupabaseRotate(repos: Repos, req: IncomingMessage, res: ServerResponse, key: string): Promise<void> {
  const workspace = repos.getWorkspaceByKey(key)
  if (!workspace) return json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
  const body = await readJson(req) as { token?: unknown }
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  const result = await rotateSupabaseManagementToken({
    token,
    surface: "setup-ui",
    client: new SupabaseManagementClient({ token }),
  })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleWorkspaceSupabaseBranch(repos: Repos, req: IncomingMessage, res: ServerResponse, key: string): Promise<void> {
  const workspace = repos.getWorkspaceByKey(key)
  if (!workspace) return json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
  const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  if (!token) return json(res, 400, { ok: false, error: "token_required", message: "Supabase Management API token is required" })
  const body = await readJson(req) as { mode?: unknown }
  const mode = body.mode === "attach" ? "attach" : "create"
  const client = new SupabaseManagementClient({ token })
  const result = await createOrAttachPersistentTestBranch({
    repos,
    workspaceId: workspace.id,
    client,
    mode,
    poll: { timeoutMs: 60_000, initialDelayMs: 2_000, maxDelayMs: 10_000 },
  })
  json(res, result.ok ? 200 : 409, result)
}

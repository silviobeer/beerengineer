import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import { patchAppConfig } from "../../setup/appConfigPatch.js"
import {
  readGlobalGitReadiness,
  readWorkspaceGitReadiness,
  repairWorkspaceGitIdentity,
  validateGitIdentityInput,
  type WorkspaceGitReadinessTarget,
} from "../../setup/gitIdentity.js"
import { json, readJson } from "../http.js"

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function resolveWorkspaceFromBody(repos: Repos, body: Record<string, unknown>): WorkspaceGitReadinessTarget | null {
  const workspaceId = stringField(body.workspaceId)
  const workspaceKey = stringField(body.workspaceKey)
  const workspace = workspaceId
    ? repos.getWorkspace(workspaceId)
    : workspaceKey
      ? repos.getWorkspaceByKey(workspaceKey)
      : undefined
  if (!workspace) return null
  return {
    id: workspace.id,
    key: workspace.key,
    rootPath: workspace.root_path,
  }
}

function resolveWorkspaceFromQuery(repos: Repos, url: URL): WorkspaceGitReadinessTarget | null {
  const workspaceId = url.searchParams.get("workspaceId")?.trim()
  const workspaceKey = url.searchParams.get("workspaceKey")?.trim()
  if (!workspaceId && !workspaceKey) return null
  const workspace = workspaceId
    ? repos.getWorkspace(workspaceId)
    : workspaceKey
      ? repos.getWorkspaceByKey(workspaceKey)
      : undefined
  if (!workspace) return { id: workspaceId || workspaceKey || "", key: workspaceKey ?? undefined, rootPath: null }
  return {
    id: workspace.id,
    key: workspace.key,
    rootPath: workspace.root_path,
  }
}

function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

export function handleGitReadiness(repos: Repos, config: AppConfig, url: URL, res: ServerResponse): void {
  const workspace = resolveWorkspaceFromQuery(repos, url)
  if (workspace) {
    if (!workspace.rootPath) {
      json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
      return
    }
    json(res, 200, readWorkspaceGitReadiness(workspace, config))
    return
  }
  json(res, 200, readGlobalGitReadiness(config))
}

export async function handleGitIdentitySave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = bodyObject(await readJson(req))
  const identity = bodyObject(body.identity ?? body.gitIdentityDefault ?? body)
  const validation = validateGitIdentityInput({
    displayName: identity.displayName,
    email: identity.email,
  })
  if (!validation.ok) {
    json(res, 400, validation)
    return
  }
  const result = patchAppConfig({}, {
    gitIdentityDefault: {
      displayName: validation.identity.displayName,
      email: validation.identity.email,
    },
  })
  json(res, result.ok ? 200 : 400, result)
}

export async function handleWorkspaceGitIdentityRepair(
  repos: Repos,
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = bodyObject(await readJson(req))
  const workspace = resolveWorkspaceFromBody(repos, body)
  if (!workspace) {
    json(res, 404, { ok: false, error: "workspace_not_found", message: "Workspace not found" })
    return
  }
  const identity = bodyObject(body.identity ?? body)
  const result = repairWorkspaceGitIdentity(workspace, config, {
    displayName: identity.displayName,
    email: identity.email,
  })
  const status = result.ok
    ? 200
    : result.error === "identity_invalid"
      ? 400
      : result.error === "workspace_path_unavailable" || result.error === "workspace_not_git_repo"
        ? 409
        : 400
  json(res, status, result)
}

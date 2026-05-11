import type { Repos } from "../db/repositories.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "./secretMetadata.js"
import { storeSecret, type SecretStoreOptions } from "./secretStore.js"
import type { SupabaseManagementClient } from "../core/supabase/managementClient.js"
import { SupabaseManagementError } from "../core/supabase/managementClient.js"
import type { SupabaseDbMode, SupabaseProject, SupabaseReadinessSetupAction } from "../core/supabase/types.js"

export type SupabaseConnectResult =
  | { ok: true; projectRef: string; region: string; dbMode: SupabaseDbMode }
  | {
      ok: false
      message: string
      error: "validation_failed" | "workspace_not_found" | "project_ref_required" | "token_required"
      recoveryAction?: SupabaseReadinessSetupAction
    }

function classifySupabaseConnectFailure(err: unknown): { message: string; action: SupabaseReadinessSetupAction } {
  const message = err instanceof Error ? err.message : "Supabase validation failed"
  if (err instanceof SupabaseManagementError && err.status === 403) {
    return { message, action: "Re-authorize project access" }
  }
  if (err instanceof SupabaseManagementError && err.status === 401) {
    return { message, action: "Rotate management token" }
  }
  return { message, action: "Rotate management token" }
}

function classifySupabaseDbMode(project: SupabaseProject): SupabaseDbMode {
  return project.branchingEnabled === false ? "direct" : "branching"
}

export async function connectSupabaseProject(input: {
  repos: Repos
  workspaceId: string
  token: string
  projectRef: string
  client: Pick<SupabaseManagementClient, "listProjects">
  secretStore?: SecretStoreOptions
}): Promise<SupabaseConnectResult> {
  const token = input.token.trim()
  const projectRef = input.projectRef.trim()
  if (!token) return { ok: false, error: "token_required", message: "Supabase Management API token is required", recoveryAction: "Store management token" }
  if (!projectRef) return { ok: false, error: "project_ref_required", message: "Supabase project ref is required", recoveryAction: "Connect Supabase project" }
  const workspace = input.repos.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, error: "workspace_not_found", message: "Workspace not found" }
  let project: SupabaseProject | undefined
  try {
    const projects = await input.client.listProjects()
    project = projects.find(candidate => candidate.ref === projectRef || candidate.id === projectRef)
  } catch (err) {
    const failure = classifySupabaseConnectFailure(err)
    return {
      ok: false,
      error: "validation_failed",
      message: failure.message,
      recoveryAction: failure.action,
    }
  }
  if (!project) {
    return {
      ok: false,
      error: "validation_failed",
      message: `Supabase project ${projectRef} was not returned by the Management API`,
      recoveryAction: "Re-authorize project access",
    }
  }
  const region = project.region ?? "unknown"
  const dbMode = classifySupabaseDbMode(project)
  storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, token, input.secretStore)
  input.repos.connectWorkspaceSupabase(workspace.id, { projectRef, region, dbMode })
  input.repos.preserveWorkspaceSupabaseProtection(workspace.id)
  return { ok: true, projectRef, region, dbMode }
}

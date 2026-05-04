import type { Repos } from "../db/repositories.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "./secretMetadata.js"
import { storeSecret, type SecretStoreOptions } from "./secretStore.js"
import type { SupabaseManagementClient } from "../core/supabase/managementClient.js"

export type SupabaseConnectResult =
  | { ok: true; projectRef: string; region: string }
  | { ok: false; message: string; error: "validation_failed" | "workspace_not_found" }

export async function connectSupabaseProject(input: {
  repos: Repos
  workspaceId: string
  token: string
  projectRef: string
  client: Pick<SupabaseManagementClient, "listProjects">
  secretStore?: SecretStoreOptions
}): Promise<SupabaseConnectResult> {
  const workspace = input.repos.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, error: "workspace_not_found", message: "Workspace not found" }
  try {
    const projects = await input.client.listProjects()
    const project = projects.find(candidate => candidate.ref === input.projectRef || candidate.id === input.projectRef)
    if (!project) return { ok: false, error: "validation_failed", message: `Supabase project ${input.projectRef} was not returned by the Management API` }
    const region = project.region ?? "unknown"
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, input.token, input.secretStore)
    input.repos.connectWorkspaceSupabase(workspace.id, { projectRef: input.projectRef, region })
    input.repos.preserveWorkspaceSupabaseProtection(workspace.id)
    return { ok: true, projectRef: input.projectRef, region }
  } catch (err) {
    return {
      ok: false,
      error: "validation_failed",
      message: err instanceof Error ? err.message : "Supabase validation failed",
    }
  }
}

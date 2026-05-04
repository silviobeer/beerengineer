import type { Repos } from "../db/repositories.js"
import type { WorkspaceRow } from "../db/repositories/types.js"

export type SupabaseSettingsPatch =
  | {
      ok: true
      supabase: {
        cleanupPolicy: WorkspaceRow["supabase_cleanup_policy"]
        cleanupTtlHours?: number
        productionMigrationProtection: WorkspaceRow["supabase_protection_switch"]
        settingsVersion: number
      }
    }
  | { ok: false; error: string; message: string; field?: string }

function parsePolicy(value: unknown): WorkspaceRow["supabase_cleanup_policy"] | null {
  return value === "on-success-immediate" || value === "ttl-after-success" || value === "manual" ? value : null
}

function parseProtection(value: unknown): WorkspaceRow["supabase_protection_switch"] | null {
  return value === "off" || value === "on" ? value : null
}

export function patchSupabaseSettings(repos: Repos, input: {
  workspaceId?: unknown
  cleanupPolicy?: unknown
  cleanupTtlHours?: unknown
  productionMigrationProtection?: unknown
  expectedVersion?: unknown
  confirmed?: unknown
}): SupabaseSettingsPatch {
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : ""
  if (!workspaceId) return { ok: false, error: "workspace_required", message: "workspaceId is required", field: "workspaceId" }
  const cleanupPolicy = parsePolicy(input.cleanupPolicy)
  if (!cleanupPolicy) return { ok: false, error: "invalid_cleanup_policy", message: "Cleanup policy is invalid.", field: "cleanupPolicy" }
  const productionMigrationProtection = parseProtection(input.productionMigrationProtection)
  if (!productionMigrationProtection) return { ok: false, error: "invalid_protection_switch", message: "Production migration protection is invalid.", field: "productionMigrationProtection" }
  const expectedVersion = typeof input.expectedVersion === "number" ? input.expectedVersion : Number(input.expectedVersion)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, error: "invalid_settings_version", message: "settingsVersion is required.", field: "settingsVersion" }
  let cleanupTtlHours: number | null = null
  if (cleanupPolicy === "ttl-after-success") {
    cleanupTtlHours = typeof input.cleanupTtlHours === "number" ? input.cleanupTtlHours : Number(input.cleanupTtlHours)
    if (!Number.isInteger(cleanupTtlHours) || cleanupTtlHours <= 0) {
      return { ok: false, error: "invalid_cleanup_ttl", message: "Cleanup TTL hours must be a positive integer.", field: "cleanupTtlHours" }
    }
  }
  if (productionMigrationProtection === "on" && input.confirmed !== true) {
    return { ok: false, error: "confirmation_required", message: "Confirm enabling production migration protection.", field: "productionMigrationProtection" }
  }
  const result = repos.updateWorkspaceSupabaseSettings(workspaceId, {
    cleanupPolicy,
    cleanupTtlHours,
    productionMigrationProtection,
    expectedVersion,
  })
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: result.error === "settings_changed" ? "Settings changed. Reload before saving." : "Workspace not found.",
    }
  }
  return {
    ok: true,
    supabase: {
      cleanupPolicy: result.workspace.supabase_cleanup_policy,
      cleanupTtlHours: result.workspace.supabase_cleanup_ttl_hours ?? undefined,
      productionMigrationProtection: result.workspace.supabase_protection_switch,
      settingsVersion: result.workspace.supabase_settings_version,
    },
  }
}

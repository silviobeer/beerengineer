import { getSecretMetadata, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { SupabaseAdapter } from "../supabase/types.js"
import type { SupabaseManagementClient } from "../supabase/managementClient.js"
import { SupabaseManagementError } from "../supabase/managementClient.js"
import { trackedSupabaseHandoffFiles } from "../supabase/handoffAudit.js"
import {
  preflightNotConfigured,
  preflightReady,
  type CapabilityAvailabilityResult,
  type CapabilityDefinition,
  type CapabilityPreflightResult,
} from "./types.js"

export { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF }

export type SupabaseWorkspaceMetadata = {
  projectRef?: string | null
  rootPath?: string | null
}

export type SupabaseCapabilityOptions = {
  workspace?: SupabaseWorkspaceMetadata
  secretStore?: SecretStoreOptions
  adapter?: SupabaseAdapter
  managementClient?: Pick<SupabaseManagementClient, "getProject" | "listBranches">
}

type LocalSupabaseConfig = {
  hasToken: boolean
  projectRef?: string
  missingReason: string
}

function normalizeProjectRef(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function localConfig(options: SupabaseCapabilityOptions): LocalSupabaseConfig {
  const token = getSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, options.secretStore)
  const hasToken = token.present && token.active
  const projectRef = normalizeProjectRef(options.workspace?.projectRef)
  const missing: string[] = []
  if (!hasToken) missing.push("management token missing")
  if (!projectRef) missing.push("project ref missing")
  return {
    hasToken,
    projectRef,
    missingReason: missing.join(" and "),
  }
}

export function createSupabaseCapability(options: SupabaseCapabilityOptions = {}): CapabilityDefinition<"supabase"> {
  const availability = (): CapabilityAvailabilityResult => {
    const config = localConfig(options)
    if (!config.hasToken || !config.projectRef) {
      return { capabilityId: "supabase", available: false, reason: config.missingReason }
    }
    return {
      capabilityId: "supabase",
      available: true,
      reason: "configured",
      context: { projectRef: config.projectRef },
    }
  }

  const preflight = async (): Promise<CapabilityPreflightResult> => {
    const available = availability()
    if (!available.available) {
      return preflightNotConfigured("supabase", available.reason ?? "supabase is not configured")
    }
    if (!options.managementClient || !localConfig(options).projectRef) return preflightReady("supabase", available.context)
    try {
      const project = await options.managementClient.getProject(localConfig(options).projectRef!)
      const branches = await options.managementClient.listBranches(localConfig(options).projectRef!)
      if (project.branchingEnabled === false) {
        return { capabilityId: "supabase", status: "failed", reason: "Supabase branching is not enabled for this project" }
      }
      return preflightReady("supabase", {
        projectRef: localConfig(options).projectRef,
        plan: project.plan ?? "unknown",
        branchingEnabled: project.branchingEnabled ?? true,
        branchQuotaUsage: branches.length,
        branchQuotaLimit: project.branchQuotaLimit ?? null,
      })
    } catch (err) {
      const message = err instanceof SupabaseManagementError ? err.message : err instanceof Error ? err.message : "Supabase preflight failed"
      const scopeHint = err instanceof SupabaseManagementError && err.status === 403
        ? " Missing Supabase token capability: list projects and branches. Check Supabase token settings."
        : ""
      return { capabilityId: "supabase", status: "failed", reason: `${message}${scopeHint}` }
    }
  }

  const notConfigured = (): CapabilityPreflightResult =>
    preflightNotConfigured("supabase", localConfig(options).missingReason || "supabase is not configured")

  const audit = (): CapabilityPreflightResult => {
    const root = options.workspace?.rootPath
    if (root) {
      const tracked = trackedSupabaseHandoffFiles(root)
      if (tracked.length > 0) {
        return { capabilityId: "supabase", status: "failed", reason: "Supabase handoff files are tracked by git", context: { tracked } }
      }
    }
    return notConfigured()
  }

  return {
    id: "supabase",
    ports: {
      availability,
      preflight,
      connect: notConfigured,
      audit,
      repair: notConfigured,
    },
  }
}

export const supabaseCapability = createSupabaseCapability()

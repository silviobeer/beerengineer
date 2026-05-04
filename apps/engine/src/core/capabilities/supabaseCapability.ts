import { getSecretMetadata, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { SupabaseAdapter } from "../supabase/types.js"
import type { SupabaseManagementClient } from "../supabase/managementClient.js"
import { SupabaseManagementError } from "../supabase/managementClient.js"
import { trackedSupabaseHandoffFiles } from "../supabase/handoffAudit.js"
import { detectSupabaseDrift } from "../supabase/driftDetector.js"
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
  persistentTestBranchRef?: string | null
}

export type SupabaseCapabilityOptions = {
  workspace?: SupabaseWorkspaceMetadata
  secretStore?: SecretStoreOptions
  adapter?: SupabaseAdapter
  managementClient?: Pick<SupabaseManagementClient, "getProject" | "listBranches"> & {
    runQuery?: (projectRef: string, branchRef: string, sql: string) => Promise<{ rows?: unknown[] }>
  }
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
    const config = localConfig(options)
    if (!config.hasToken || !config.projectRef) {
      return preflightNotConfigured("supabase", config.missingReason || "supabase is not configured")
    }
    if (!options.managementClient) {
      return preflightReady("supabase", { projectRef: config.projectRef })
    }
    try {
      const [project, branches] = await Promise.all([
        options.managementClient.getProject(config.projectRef),
        options.managementClient.listBranches(config.projectRef),
      ])
      if (project.branchingEnabled === false) {
        return { capabilityId: "supabase", status: "failed", reason: "Supabase branching is not enabled for this project" }
      }
      return preflightReady("supabase", {
        projectRef: config.projectRef,
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

  const audit = async (): Promise<CapabilityPreflightResult> => {
    const root = options.workspace?.rootPath
    if (root) {
      const tracked = trackedSupabaseHandoffFiles(root)
      if (tracked.length > 0) {
        return { capabilityId: "supabase", status: "failed", reason: "Supabase handoff files are tracked by git", context: { tracked } }
      }
    }
    const config = localConfig(options)
    if (!config.hasToken || !config.projectRef) return notConfigured()
    const branchRef = options.workspace?.persistentTestBranchRef
    if (!root || !branchRef || !options.managementClient?.runQuery) return preflightReady("supabase", { status: "ready" })
    try {
      const migrations = await options.managementClient.runQuery(config.projectRef!, branchRef, "select name from supabase_migrations.schema_migrations")
      const appliedMigrations = (migrations.rows ?? []).map(row => {
        if (typeof row === "string") return row
        if (typeof row === "object" && row) {
          const value = (row as { name?: unknown; version?: unknown }).name ?? (row as { version?: unknown }).version
          return typeof value === "string" ? value : ""
        }
        return ""
      }).filter(Boolean)
      let identityRows: Array<{ id: string; expected: unknown; actual: unknown }> = []
      try {
        const identities = await options.managementClient.runQuery(config.projectRef!, branchRef, "select id, expected, actual from beerengineer_seed_identity")
        identityRows = (identities.rows ?? []).filter((row): row is { id: string; expected: unknown; actual: unknown } => {
          return typeof row === "object" && row !== null && typeof (row as { id?: unknown }).id === "string"
        })
      } catch {
        identityRows = [{ id: "seed-identity-table-missing", expected: true, actual: false }]
      }
      const report = detectSupabaseDrift({ workspaceRoot: root, appliedMigrations, seedIdentityRows: identityRows })
      return {
        capabilityId: "supabase",
        status: report.status === "ready" ? "ready" : "warning",
        reason: report.status,
        context: report,
      }
    } catch (err) {
      return { capabilityId: "supabase", status: "failed", reason: err instanceof Error ? err.message : "Supabase audit failed" }
    }
  }

  const repair = async (): Promise<CapabilityPreflightResult> => {
    const result = await audit()
    if (result.status === "failed" || result.status === "not_configured") return result
    const report = result.context as { extraMigrations?: unknown[]; identityDrift?: unknown[] } | undefined
    const insufficient = (report?.extraMigrations?.length ?? 0) > 0
    return {
      capabilityId: "supabase",
      status: insufficient ? "warning" : "ready",
      reason: insufficient ? "non-destructive-repair-insufficient" : "ready",
      context: { status: insufficient ? "non-destructive-repair-insufficient" : "ready" },
    }
  }

  return {
    id: "supabase",
    ports: {
      availability,
      preflight,
      connect: notConfigured,
      audit,
      repair,
    },
  }
}

export const supabaseCapability = createSupabaseCapability()

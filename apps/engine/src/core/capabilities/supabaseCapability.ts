import { getSecretMetadata, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { SupabaseAdapter } from "../supabase/types.js"
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
}

export type SupabaseCapabilityOptions = {
  workspace?: SupabaseWorkspaceMetadata
  secretStore?: SecretStoreOptions
  adapter?: SupabaseAdapter
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

  const preflight = (): CapabilityPreflightResult => {
    const available = availability()
    if (!available.available) {
      return preflightNotConfigured("supabase", available.reason ?? "supabase is not configured")
    }
    return preflightReady("supabase", available.context)
  }

  const notConfigured = (): CapabilityPreflightResult =>
    preflightNotConfigured("supabase", localConfig(options).missingReason || "supabase is not configured")

  return {
    id: "supabase",
    ports: {
      availability,
      preflight,
      connect: notConfigured,
      audit: notConfigured,
      repair: notConfigured,
    },
  }
}

export const supabaseCapability = createSupabaseCapability()

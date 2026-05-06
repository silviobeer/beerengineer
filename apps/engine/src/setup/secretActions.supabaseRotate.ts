import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "./secretMetadata.js"
import { readActiveSecretValue, storeSecret, type SecretMetadata, type SecretStoreOptions } from "./secretStore.js"
import type { SupabaseManagementClient } from "../core/supabase/managementClient.js"
import { SupabaseManagementError } from "../core/supabase/managementClient.js"
import type { SupabaseReadinessSetupAction } from "../core/supabase/types.js"

export type SupabaseTokenRotationSurface = "cli" | "ui" | "setup-cli" | "setup-ui"

export type SupabaseTokenRotatedEvent = {
  type: "supabase.token.rotated"
  timestamp: number
  surface: SupabaseTokenRotationSurface
}

export type SupabaseTokenRotationResult =
  | { ok: true; secret: SecretMetadata; event: SupabaseTokenRotatedEvent }
  | {
      ok: false
      error: "validation_failed" | "token_required"
      message: string
      previousTokenPresent: boolean
      recoveryAction: SupabaseReadinessSetupAction
    }

export async function rotateSupabaseManagementToken(input: {
  token: string
  surface: SupabaseTokenRotationSurface
  client: Pick<SupabaseManagementClient, "listProjects">
  secretStore?: SecretStoreOptions
  now?: () => number
  auditSink?: (event: SupabaseTokenRotatedEvent) => void
}): Promise<SupabaseTokenRotationResult> {
  const token = input.token.trim()
  const previousTokenPresent = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, input.secretStore) !== null
  if (!token) {
    return {
      ok: false,
      error: "token_required",
      message: "Supabase Management API token is required",
      previousTokenPresent,
      recoveryAction: previousTokenPresent ? "Rotate management token" : "Store management token",
    }
  }
  try {
    await input.client.listProjects()
  } catch (err) {
    const recoveryAction =
      err instanceof SupabaseManagementError && err.status === 403
        ? "Re-authorize project access"
        : "Rotate management token"
    return {
      ok: false,
      error: "validation_failed",
      message: err instanceof Error ? err.message : "Supabase validation failed",
      previousTokenPresent,
      recoveryAction,
    }
  }
  const secret = storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, token, input.secretStore)
  const event: SupabaseTokenRotatedEvent = {
    type: "supabase.token.rotated",
    timestamp: input.now?.() ?? Date.now(),
    surface: input.surface,
  }
  input.auditSink?.(event)
  return { ok: true, secret, event }
}

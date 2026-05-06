import {
  deleteSecret,
  setSecretActive,
  storeSecret,
  type SecretMetadata,
  type SecretStoreOptions,
} from "./secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "./secretMetadata.js"

export type SecretActionInput =
  | { action: "replace"; value?: unknown }
  | { action: "disable" }
  | { action: "reactivate" }
  | { action: "delete" }

export type SecretActionResult =
  | { ok: true; secret: SecretMetadata }
  | { ok: false; error: string; secret?: SecretMetadata }

function parseInput(input: unknown): SecretActionInput {
  if (!input || typeof input !== "object") throw new TypeError("secret action payload must be an object")
  const action = (input as { action?: unknown }).action
  if (action === "replace" || action === "disable" || action === "reactivate" || action === "delete") {
    return input as SecretActionInput
  }
  throw new TypeError("secret action must be replace, disable, reactivate, or delete")
}

export function applySecretAction(ref: string, input: unknown, options: SecretStoreOptions = {}): SecretActionResult {
  try {
    if (ref === SUPABASE_MANAGEMENT_TOKEN_SECRET_REF) {
      return { ok: false, error: "supabase_management_token_requires_dedicated_flow" }
    }
    const parsed = parseInput(input)
    if (parsed.action === "replace") {
      if (typeof parsed.value !== "string" || parsed.value.length === 0) {
        return { ok: false, error: "secret_value_required" }
      }
      return { ok: true, secret: storeSecret(ref, parsed.value, options) }
    }
    if (parsed.action === "disable") return { ok: true, secret: setSecretActive(ref, false, options) }
    if (parsed.action === "reactivate") return { ok: true, secret: setSecretActive(ref, true, options) }
    return { ok: true, secret: deleteSecret(ref, options) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

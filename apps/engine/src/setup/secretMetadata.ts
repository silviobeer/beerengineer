import { getSecretMetadata, type SecretMetadata, type SecretStoreOptions } from "./secretStore.js"

export const SUPABASE_MANAGEMENT_TOKEN_SECRET_REF = "supabase.management_token"

export const KNOWN_SECRET_REFS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SONAR_TOKEN",
  SUPABASE_MANAGEMENT_TOKEN_SECRET_REF,
] as const

export type OptionalSecretGate = {
  ref: string
  status: "skipped" | "configured" | "failed"
  skippable: boolean
  secret: SecretMetadata
}

export function readSecretMetadata(ref: string, options: SecretStoreOptions = {}): SecretMetadata {
  return getSecretMetadata(ref, options)
}

export function optionalSecretGate(ref: string, options: SecretStoreOptions = {}): OptionalSecretGate {
  const secret = readSecretMetadata(ref, options)
  return {
    ref,
    status: optionalSecretGateStatus(secret),
    skippable: secret.status === "missing" || secret.status === "disabled",
    secret,
  }
}

function optionalSecretGateStatus(secret: SecretMetadata): OptionalSecretGate["status"] {
  if (secret.status === "missing" || secret.status === "disabled") return "skipped"
  if (secret.status === "invalid" || secret.status === "suspicious" || secret.status === "unknown") return "failed"
  return "configured"
}

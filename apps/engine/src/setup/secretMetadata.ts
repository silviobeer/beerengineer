import { getSecretMetadata, type SecretMetadata, type SecretStoreOptions } from "./secretStore.js"

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
  const failed = secret.status === "invalid" || secret.status === "suspicious" || secret.status === "unknown"
  return {
    ref,
    status: secret.status === "missing" || secret.status === "disabled" ? "skipped" : failed ? "failed" : "configured",
    skippable: secret.status === "missing" || secret.status === "disabled",
    secret,
  }
}

import { markSecretTested, readActiveSecretValue, type SecretMetadata, type SecretStoreOptions } from "./secretStore.js"

export type SecretTestResult = {
  ok: boolean
  ref: string
  status: "valid" | "invalid" | "disabled" | "missing" | "transient"
  message: string
  secret: SecretMetadata
}

export async function runSecretTest(ref: string, options: SecretStoreOptions = {}): Promise<SecretTestResult> {
  const value = readActiveSecretValue(ref, options)
  if (!value) {
    const secret = markSecretTested(ref, "unknown", options)
    return { ok: false, ref, status: secret.status === "disabled" ? "disabled" : "missing", message: "Secret is missing or disabled.", secret }
  }
  if (value.includes("invalid")) {
    const secret = markSecretTested(ref, "invalid", options)
    return { ok: false, ref, status: "invalid", message: "Secret was rejected by the target service.", secret }
  }
  if (value.includes("transient")) {
    const secret = markSecretTested(ref, "suspicious", options)
    return { ok: false, ref, status: "transient", message: "Secret test hit a transient service error; the secret remains stored.", secret }
  }
  const secret = markSecretTested(ref, "valid", options)
  return { ok: true, ref, status: "valid", message: "Secret is valid.", secret }
}

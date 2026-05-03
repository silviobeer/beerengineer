import { getSecretMetadata, markSecretTested, readActiveSecretValue, type SecretMetadata, type SecretStoreOptions } from "./secretStore.js"

export class SecretTestNotImplementedError extends Error {
  constructor(ref: string) {
    super(`No secret tester is registered for ${ref}`)
    this.name = "SecretTestNotImplementedError"
  }
}

export type SecretTestResult = {
  ok: boolean
  ref: string
  status: "valid" | "invalid" | "disabled" | "missing" | "transient" | "not_implemented"
  message: string
  secret: SecretMetadata
}

export type SecretTesterResult =
  | { status: "valid"; message?: string }
  | { status: "invalid"; message?: string }
  | { status: "transient"; message?: string }

export type SecretTester = (input: { ref: string; value: string }) => Promise<SecretTesterResult> | SecretTesterResult

export type SecretTestOptions = SecretStoreOptions & {
  testers?: Record<string, SecretTester>
}

export async function runSecretTest(ref: string, options: SecretTestOptions = {}): Promise<SecretTestResult> {
  const value = readActiveSecretValue(ref, options)
  if (!value) {
    const previous = getSecretMetadata(ref, options)
    const secret = markSecretTested(ref, "unknown", options)
    return { ok: false, ref, status: previous.status === "missing" ? "missing" : "disabled", message: "Secret is missing or disabled.", secret }
  }
  const tester = options.testers?.[ref]
  if (!tester) {
    const secret = getSecretMetadata(ref, options)
    return { ok: false, ref, status: "not_implemented", message: new SecretTestNotImplementedError(ref).message, secret }
  }

  const tested = await tester({ ref, value })
  if (tested.status === "invalid") {
    const secret = markSecretTested(ref, "invalid", options)
    return { ok: false, ref, status: "invalid", message: tested.message ?? "Secret was rejected by the target service.", secret }
  }
  if (tested.status === "transient") {
    const secret = markSecretTested(ref, "suspicious", options)
    return { ok: false, ref, status: "transient", message: tested.message ?? "Secret test hit a transient service error; the secret remains stored.", secret }
  }
  const secret = markSecretTested(ref, "valid", options)
  return { ok: true, ref, status: "valid", message: tested.message ?? "Secret is valid.", secret }
}

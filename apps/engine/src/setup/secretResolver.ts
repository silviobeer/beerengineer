import { readActiveSecretValue, type SecretStoreOptions } from "./secretStore.js"

export type SecretResolution =
  | { ok: true; ref: string; source: "env" | "store"; env: Record<string, string> }
  | { ok: false; ref: string; source: "missing" | "disabled"; env: Record<string, string>; reason: string }

export function resolveSecretForExecution(
  envName: string,
  ref = envName,
  options: SecretStoreOptions = {},
): SecretResolution {
  const fromEnv = process.env[envName]
  if (fromEnv) return { ok: true, ref, source: "env", env: { [envName]: fromEnv } }
  const fromStore = readActiveSecretValue(ref, options)
  if (fromStore) return { ok: true, ref, source: "store", env: { [envName]: fromStore } }
  return { ok: false, ref, source: "missing", env: {}, reason: "secret is missing or disabled" }
}

export async function withResolvedSecret<T>(
  envName: string,
  ref: string,
  fn: (env: Record<string, string>, source: "env" | "store") => Promise<T> | T,
  options: SecretStoreOptions = {},
): Promise<{ ok: true; source: "env" | "store"; result: T } | { ok: false; reason: string }> {
  const resolved = resolveSecretForExecution(envName, ref, options)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  return { ok: true, source: resolved.source, result: await fn(resolved.env, resolved.source) }
}

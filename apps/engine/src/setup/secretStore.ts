import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import envPaths from "env-paths"

export type SecretStatus = "missing" | "active" | "disabled" | "unknown"

export type SecretMetadata = {
  ref: string
  status: SecretStatus
  active: boolean
  updatedAt?: number
  lastTestedAt?: number
}

export type SecretStoreOptions = {
  storePath?: string
}

type SecretRecord = {
  value: string
  active: boolean
  updatedAt: number
  lastTestedAt?: number
}

type SecretStoreFile = {
  schemaVersion: 1
  secrets: Record<string, SecretRecord>
}

const paths = envPaths("beerengineer")

export function secretStorePath(options: SecretStoreOptions = {}): string {
  const explicit = options.storePath ?? process.env.BEERENGINEER_SECRET_STORE_PATH
  return explicit ? resolve(explicit) : resolve(paths.data, "secrets.json")
}

function emptyStore(): SecretStoreFile {
  return { schemaVersion: 1, secrets: {} }
}

function readStore(options: SecretStoreOptions = {}): SecretStoreFile {
  const path = secretStorePath(options)
  if (!existsSync(path)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretStoreFile
    if (parsed.schemaVersion !== 1 || !parsed.secrets || typeof parsed.secrets !== "object") return emptyStore()
    return parsed
  } catch {
    return emptyStore()
  }
}

function writeStore(store: SecretStoreFile, options: SecretStoreOptions = {}): void {
  const path = secretStorePath(options)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  renameSync(tmp, path)
}

function metadataFor(ref: string, record: SecretRecord | undefined): SecretMetadata {
  if (!record) return { ref, status: "missing", active: false }
  return {
    ref,
    status: record.active ? "active" : "disabled",
    active: record.active,
    updatedAt: record.updatedAt,
    lastTestedAt: record.lastTestedAt,
  }
}

export function storeSecret(ref: string, value: string, options: SecretStoreOptions = {}): SecretMetadata {
  if (!ref.trim()) throw new TypeError("secret ref must be non-empty")
  if (typeof value !== "string" || value.length === 0) throw new TypeError("secret value must be non-empty")
  const store = readStore(options)
  store.secrets[ref] = { value, active: true, updatedAt: Date.now() }
  writeStore(store, options)
  return metadataFor(ref, store.secrets[ref])
}

export function getSecretMetadata(ref: string, options: SecretStoreOptions = {}): SecretMetadata {
  const store = readStore(options)
  return metadataFor(ref, store.secrets[ref])
}

export function setSecretActive(ref: string, active: boolean, options: SecretStoreOptions = {}): SecretMetadata {
  const store = readStore(options)
  const record = store.secrets[ref]
  if (!record) return metadataFor(ref, undefined)
  record.active = active
  record.updatedAt = Date.now()
  writeStore(store, options)
  return metadataFor(ref, record)
}

export function deleteSecret(ref: string, options: SecretStoreOptions = {}): SecretMetadata {
  const store = readStore(options)
  delete store.secrets[ref]
  writeStore(store, options)
  return metadataFor(ref, undefined)
}

export function readActiveSecretValue(ref: string, options: SecretStoreOptions = {}): string | null {
  const store = readStore(options)
  const record = store.secrets[ref]
  if (!record?.active) return null
  return record.value
}

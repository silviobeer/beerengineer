import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import envPaths from "env-paths"

export type SecretStatus = "missing" | "active" | "disabled" | "invalid" | "suspicious" | "unknown"

export type SecretMetadata = {
  ref: string
  status: SecretStatus
  present: boolean
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
  testStatus?: "valid" | "invalid" | "suspicious" | "unknown"
}

type SecretStoreFile = {
  schemaVersion: 1
  secrets: Record<string, SecretRecord>
}

const paths = envPaths("beerengineer")
const activeMutations = new Set<string>()

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

function mutateStore(options: SecretStoreOptions, mutate: (store: SecretStoreFile) => SecretMetadata): SecretMetadata {
  const path = secretStorePath(options)
  if (activeMutations.has(path)) throw new Error("secret store mutation already in progress")
  activeMutations.add(path)
  try {
    const store = readStore(options)
    const result = mutate(store)
    writeStore(store, options)
    return result
  } finally {
    activeMutations.delete(path)
  }
}

function metadataFor(ref: string, record: SecretRecord | undefined): SecretMetadata {
  if (!record) return { ref, status: "missing", present: false, active: false }
  return {
    ref,
    status: metadataStatus(record),
    present: true,
    active: record.active,
    updatedAt: record.updatedAt,
    lastTestedAt: record.lastTestedAt,
  }
}

function metadataStatus(record: SecretRecord): SecretStatus {
  if (record.testStatus === "invalid") return "invalid"
  if (record.testStatus === "suspicious") return "suspicious"
  if (record.testStatus === "unknown") return "unknown"
  if (!record.active) return "disabled"
  return "active"
}

export function storeSecret(ref: string, value: string, options: SecretStoreOptions = {}): SecretMetadata {
  if (!ref.trim()) throw new TypeError("secret ref must be non-empty")
  if (typeof value !== "string" || value.length === 0) throw new TypeError("secret value must be non-empty")
  return mutateStore(options, store => {
    store.secrets[ref] = { value, active: true, updatedAt: Date.now() }
    return metadataFor(ref, store.secrets[ref])
  })
}

export function getSecretMetadata(ref: string, options: SecretStoreOptions = {}): SecretMetadata {
  const store = readStore(options)
  return metadataFor(ref, store.secrets[ref])
}

export function setSecretActive(ref: string, active: boolean, options: SecretStoreOptions = {}): SecretMetadata {
  return mutateStore(options, store => {
    const record = store.secrets[ref]
    if (!record) return metadataFor(ref, undefined)
    record.active = active
    record.updatedAt = Date.now()
    return metadataFor(ref, record)
  })
}

export function deleteSecret(ref: string, options: SecretStoreOptions = {}): SecretMetadata {
  return mutateStore(options, store => {
    delete store.secrets[ref]
    return metadataFor(ref, undefined)
  })
}

export function markSecretTested(
  ref: string,
  status: "valid" | "invalid" | "suspicious" | "unknown",
  options: SecretStoreOptions = {},
): SecretMetadata {
  return mutateStore(options, store => {
    const record = store.secrets[ref]
    if (!record) return metadataFor(ref, undefined)
    record.lastTestedAt = Date.now()
    record.testStatus = status
    if (status === "invalid") record.active = false
    record.updatedAt = Date.now()
    return metadataFor(ref, record)
  })
}

export function readActiveSecretValue(ref: string, options: SecretStoreOptions = {}): string | null {
  const store = readStore(options)
  const record = store.secrets[ref]
  if (!record?.active) return null
  return record.value
}
